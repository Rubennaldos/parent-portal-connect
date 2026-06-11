-- ============================================================
-- MÓDULO: Comprobantes de Suministros por Sede (Branch Supply)
-- Archivo: 20260601_branch_supply_module.sql
-- Fecha  : 2026-06-01
-- Autor  : Sistema
--
-- DESCRIPCIÓN:
--   Implementa el flujo completo de ingreso de suministros
--   para administradores de sede, con auditoría dual y stock
--   atómico controlado por el Administrador General.
--
-- BLOQUES:
--   1.  Secuencia de correlativo BSR-YYYY-XXXX
--   2.  Tabla branch_supply_receipts (cabecera)
--   3.  Tabla branch_supply_receipt_items (detalle)
--   4.  Índices de rendimiento y unicidad parcial
--   5.  RLS: branch_supply_receipts
--   6.  RLS: branch_supply_receipt_items
--   7.  RPC: submit_branch_supply_receipt    (sede → pending)
--   8.  RPC: preview_branch_supply_totals   (UX, no persiste)
--   9.  RPC: approve_branch_supply_receipt  (motor atómico)
--  10.  RPC: reject_branch_supply_receipt   (rechazo con motivo)
--  11.  RPC: get_branch_supply_receipt_detail (panel auditoría)
--  12.  Vista: v_branch_supply_receipts_summary
--  13.  Storage: bucket branch_supply_evidence + RLS
--  14.  Permiso: logistica.auditar_comprobantes_sede
--
-- GARANTÍAS:
--   • Stock SOLO se mueve al aprobar (approve RPC, paso 9)
--   • Atomicidad: approve = 1 transacción, rollback total si falla
--   • Idempotente: puede ejecutarse N veces sin error
--   • Sin imports de supply_requests, inventory_items ni código legado
-- ============================================================

-- ── 1. SECUENCIA ANUAL: BSR-YYYY-XXXX ────────────────────────────────────────
-- Patrón idéntico a seq_ingress_by_year. Contador por año; reinicio anual
-- automático. ON CONFLICT DO UPDATE es atómico bajo concurrencia.

CREATE TABLE IF NOT EXISTS public.seq_branch_supply_by_year (
  year     integer PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.seq_branch_supply_by_year IS
  'Contador anual para correlativo BSR-YYYY-XXXX. Reinicio automático cada año.';

ALTER TABLE public.seq_branch_supply_by_year ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sbsby_read_admin" ON public.seq_branch_supply_by_year;
CREATE POLICY "sbsby_read_admin" ON public.seq_branch_supply_by_year
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  );

CREATE OR REPLACE FUNCTION public.fn_next_branch_supply_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM timezone('America/Lima', now()))::integer;
  v_seq  integer;
BEGIN
  INSERT INTO seq_branch_supply_by_year (year, last_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_seq = seq_branch_supply_by_year.last_seq + 1
  RETURNING last_seq INTO v_seq;

  -- Formato: BSR-2026-0001
  RETURN 'BSR-' || v_year::text || '-' || LPAD(v_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_next_branch_supply_id()
  TO authenticated, service_role;

SELECT 'OK: fn_next_branch_supply_id y seq_branch_supply_by_year creados' AS resultado;

-- ── 2. TABLA PRINCIPAL: branch_supply_receipts ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.branch_supply_receipts (
  id                   uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Correlativo interno (BSR-YYYY-XXXX), único global
  receipt_number       text          UNIQUE,

  -- Relaciones estrictas: FKs con RESTRICT para no perder trazabilidad
  school_id            uuid          NOT NULL
    REFERENCES public.schools(id)    ON DELETE RESTRICT,
  supplier_id          uuid          NOT NULL
    REFERENCES public.suppliers(id)  ON DELETE RESTRICT,
  submitted_by         uuid          NOT NULL
    REFERENCES auth.users(id)        ON DELETE SET NULL,

  -- Cabecera del comprobante físico
  doc_type             text          NOT NULL
    CHECK (doc_type IN ('boleta', 'factura', 'guia', 'nota_venta')),
  doc_number           text,                        -- NULL = comprobante sin número
  declared_total       numeric(12,2) NOT NULL
    CHECK (declared_total >= 0),
  prices_include_igv   boolean       NOT NULL DEFAULT false,
  notes                text,

  -- Evidencia: path relativo en bucket branch_supply_evidence
  -- NULL permitido (emergencia operacional); el auditor verá advertencia
  evidence_path        text,

  -- Match Score calculado en submit_branch_supply_receipt y revalidado en approve.
  -- Estructura: {lines_sum, declared_total, matched, delta_cents}
  match_score          jsonb,

  -- Workflow de auditoría
  status               text          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by          uuid
    REFERENCES auth.users(id)        ON DELETE SET NULL,
  reviewed_at          timestamptz,
  rejection_reason     text,

  -- Trazabilidad de correcciones: recibo que reemplaza a otro rechazado
  replaces_receipt_id  uuid
    REFERENCES public.branch_supply_receipts(id) ON DELETE SET NULL,

  -- Timestamps (reloj de servidor Lima, nunca cliente)
  submitted_at         timestamptz   NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz   NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.branch_supply_receipts IS
  'Comprobantes de ingreso de suministros registrados por administradores de sede. '
  'status=pending → stock intacto. Solo approve_branch_supply_receipt mueve inventario.';

COMMENT ON COLUMN public.branch_supply_receipts.receipt_number IS
  'Correlativo interno BSR-YYYY-XXXX. Generado por fn_next_branch_supply_id().';
COMMENT ON COLUMN public.branch_supply_receipts.evidence_path IS
  'Ruta relativa en bucket branch_supply_evidence. '
  'Usar createSignedUrl para vista temporal; nunca exponer URL pública.';
COMMENT ON COLUMN public.branch_supply_receipts.match_score IS
  '{lines_sum, declared_total, matched: bool, delta_cents}. '
  'Calculado en submit; REVALIDADO en approve (no confiar en valor guardado).';
COMMENT ON COLUMN public.branch_supply_receipts.prices_include_igv IS
  'true = costos unitarios YA incluyen IGV (18%). '
  'Afecta la coherencia de la comparación declarado vs digitalizado; responsabilidad del operador.';

SELECT 'OK: branch_supply_receipts creada' AS resultado;

-- ── 3. TABLA DE DETALLE: branch_supply_receipt_items ─────────────────────────

CREATE TABLE IF NOT EXISTS public.branch_supply_receipt_items (
  id          uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id  uuid          NOT NULL
    REFERENCES public.branch_supply_receipts(id) ON DELETE CASCADE,
  product_id  uuid          NOT NULL
    REFERENCES public.products(id)               ON DELETE RESTRICT,
  quantity    integer       NOT NULL CHECK (quantity > 0),
  unit_cost   numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  -- UoM: si viene con empaque (caja, tira…), increment_product_stock
  -- aplica conversion_factor en BD. NULL = unidades base directas.
  uom_id      uuid
    REFERENCES public.product_packaging(id)      ON DELETE SET NULL,
  sort_order  smallint      NOT NULL DEFAULT 0    -- orden visual de la grilla
);

COMMENT ON TABLE public.branch_supply_receipt_items IS
  'Ítems digitalizados de cada comprobante de suministro de sede. '
  'uom_id presente → increment_product_stock convierte cajas→unidades base en BD.';

SELECT 'OK: branch_supply_receipt_items creada' AS resultado;

-- ── 4. ÍNDICES ────────────────────────────────────────────────────────────────

-- Índice único PARCIAL: evita doble registro del mismo comprobante
-- (mismo proveedor + mismo número + misma sede) mientras esté activo.
-- Rechazados/cancelados pueden reingresarse con el mismo número.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bsr_unique_active_doc
  ON public.branch_supply_receipts (school_id, supplier_id, doc_number)
  WHERE status IN ('pending', 'approved')
    AND doc_number IS NOT NULL
    AND supplier_id IS NOT NULL;

-- Listado por sede + estado (consulta más frecuente en el panel sede)
CREATE INDEX IF NOT EXISTS idx_bsr_school_status
  ON public.branch_supply_receipts (school_id, status, submitted_at DESC);

-- Panel de auditoría central: todos los pendientes ordenados por fecha
CREATE INDEX IF NOT EXISTS idx_bsr_pending_submitted
  ON public.branch_supply_receipts (submitted_at DESC)
  WHERE status = 'pending';

-- Ítems de un comprobante (JOIN frecuente en auditoría y aprobación)
CREATE INDEX IF NOT EXISTS idx_bsri_receipt
  ON public.branch_supply_receipt_items (receipt_id, sort_order);

SELECT 'OK: índices creados' AS resultado;

-- ── 5. RLS: branch_supply_receipts ───────────────────────────────────────────

ALTER TABLE public.branch_supply_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bsr_select_own_school_or_admin" ON public.branch_supply_receipts;
DROP POLICY IF EXISTS "bsr_insert_own_school"          ON public.branch_supply_receipts;
DROP POLICY IF EXISTS "bsr_update_admin_general"       ON public.branch_supply_receipts;

-- SELECT: la sede ve solo sus propios comprobantes; admin_general ve todos
CREATE POLICY "bsr_select_own_school_or_admin"
  ON public.branch_supply_receipts
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT school_id FROM public.profiles WHERE id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  );

-- INSERT: el usuario solo puede registrar para su propia sede
-- Guard de módulo (admin_sede.crear_pedidos) se refuerza en la app;
-- aquí el guard de BD es estricto: school_id debe coincidir con el perfil.
CREATE POLICY "bsr_insert_own_school"
  ON public.branch_supply_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id IN (
      SELECT school_id FROM public.profiles WHERE id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  );

-- UPDATE: solo admin_general puede modificar (aprobaciones y rechazos)
-- La lógica real vive en los RPCs con SELECT…FOR UPDATE; esta política
-- es la barrera adicional de RLS.
CREATE POLICY "bsr_update_admin_general"
  ON public.branch_supply_receipts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin')
    )
  );

SELECT 'OK: RLS branch_supply_receipts configurado' AS resultado;

-- ── 6. RLS: branch_supply_receipt_items ──────────────────────────────────────

ALTER TABLE public.branch_supply_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bsri_select_via_receipt" ON public.branch_supply_receipt_items;
DROP POLICY IF EXISTS "bsri_insert_via_receipt" ON public.branch_supply_receipt_items;
DROP POLICY IF EXISTS "bsri_delete_via_receipt" ON public.branch_supply_receipt_items;

-- SELECT: derivado del acceso al comprobante padre
CREATE POLICY "bsri_select_via_receipt"
  ON public.branch_supply_receipt_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.branch_supply_receipts bsr
      WHERE bsr.id = receipt_id
        AND (
          bsr.school_id IN (
            SELECT school_id FROM public.profiles WHERE id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role IN ('admin_general', 'superadmin')
          )
        )
    )
  );

-- INSERT: la sede puede agregar ítems solo a sus propios comprobantes pending
CREATE POLICY "bsri_insert_via_receipt"
  ON public.branch_supply_receipt_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.branch_supply_receipts bsr
      WHERE bsr.id = receipt_id
        AND bsr.status = 'pending'
        AND (
          bsr.school_id IN (
            SELECT school_id FROM public.profiles WHERE id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role IN ('admin_general', 'superadmin')
          )
        )
    )
  );

-- DELETE: solo ítems de comprobantes pending de la propia sede
CREATE POLICY "bsri_delete_via_receipt"
  ON public.branch_supply_receipt_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.branch_supply_receipts bsr
      WHERE bsr.id = receipt_id
        AND bsr.status = 'pending'
        AND (
          bsr.school_id IN (
            SELECT school_id FROM public.profiles WHERE id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role IN ('admin_general', 'superadmin')
          )
        )
    )
  );

SELECT 'OK: RLS branch_supply_receipt_items configurado' AS resultado;

-- ── 7. RPC: submit_branch_supply_receipt ──────────────────────────────────────
-- Registro inicial: valida proveedor, productos, calcula match score,
-- inserta cabecera (status=pending) + ítems. NO toca product_stock.

DROP FUNCTION IF EXISTS public.submit_branch_supply_receipt(uuid,uuid,text,text,numeric,boolean,text,text,jsonb,uuid);

CREATE OR REPLACE FUNCTION public.submit_branch_supply_receipt(
  p_school_id           uuid,
  p_supplier_id         uuid,
  p_doc_type            text,
  p_doc_number          text,          -- NULL/vacío = sin número
  p_declared_total      numeric,
  p_prices_include_igv  boolean,
  p_notes               text,          -- NULL = sin notas
  p_evidence_path       text,          -- NULL = sin evidencia (permitido, auditor ve alerta)
  p_items               jsonb,         -- [{product_id, quantity, unit_cost, uom_id?}]
  p_replaces_receipt_id uuid DEFAULT NULL  -- UUID del recibo rechazado que corrige
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_receipt_id     uuid;
  v_receipt_number text;
  v_lines_sum      numeric := 0;
  v_delta          numeric;
  v_matched        boolean;
  v_item           jsonb;
  v_product_id     uuid;
  v_quantity       integer;
  v_unit_cost      numeric;
  v_uom_id         uuid;
  v_sort_order     smallint := 0;
BEGIN
  v_caller_id := auth.uid();

  -- ── MURALLA: validaciones de cabecera ──────────────────────────────────────

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para registrar un comprobante.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: school_id es obligatorio.';
  END IF;

  -- El remitente debe pertenecer a la sede declarada (o ser admin_general)
  IF NOT (
    EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND school_id = p_school_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND role IN ('admin_general','superadmin'))
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo puedes registrar comprobantes para tu propia sede.';
  END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_REQUIRED: Debes seleccionar un proveedor. '
      'No se permiten proveedores creados en la sede. '
      'Si el proveedor no existe, solicita a Logística central que lo registre.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'SUPPLIER_NOT_FOUND: El proveedor seleccionado no existe en el sistema.';
  END IF;

  IF p_doc_type NOT IN ('boleta','factura','guia','nota_venta') THEN
    RAISE EXCEPTION 'VALIDATION: Tipo de comprobante inválido: %. '
      'Use: boleta, factura, guia, nota_venta.', p_doc_type;
  END IF;

  IF p_declared_total IS NULL OR p_declared_total < 0 THEN
    RAISE EXCEPTION 'VALIDATION: El monto total declarado debe ser >= 0.';
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debes incluir al menos un producto en el comprobante.';
  END IF;

  -- Si corrige un receipt anterior, verificar que ese estaba rechazado
  IF p_replaces_receipt_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_supply_receipts
      WHERE id = p_replaces_receipt_id
        AND status = 'rejected'
        AND school_id = p_school_id
    ) THEN
      RAISE EXCEPTION 'CORRECTION_INVALID: El comprobante a corregir no existe, '
        'no está rechazado, o no pertenece a tu sede.';
    END IF;
  END IF;

  -- ── MURALLA: validar ítems + pre-calcular suma ─────────────────────────────

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);
    v_uom_id     := NULLIF(trim(COALESCE(v_item->>'uom_id', '')), '')::uuid;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION: Todos los ítems deben tener un producto seleccionado.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_product_id AND active = true) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto % no existe o está inactivo. '
        'Contacta a Logística para que lo active.', v_product_id;
    END IF;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'VALIDATION: La cantidad de cada ítem debe ser mayor a 0.';
    END IF;

    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'VALIDATION: El costo unitario no puede ser negativo.';
    END IF;

    -- Validar que el UoM pertenezca al producto correcto
    IF v_uom_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM product_packaging
        WHERE id = v_uom_id AND product_id = v_product_id
      ) THEN
        RAISE EXCEPTION 'UOM_INVALID: El empaque % no pertenece al producto %.', v_uom_id, v_product_id;
      END IF;
    END IF;

    -- Suma en BD, nunca en cliente (Regla #11.A)
    v_lines_sum := v_lines_sum + (v_quantity * v_unit_cost);
  END LOOP;

  -- ── Match Score: calcula y persiste en cabecera ────────────────────────────
  -- Redondear a 2 decimales antes de comparar elimina ruido de punto flotante.
  v_lines_sum := ROUND(v_lines_sum, 2);
  v_delta     := ABS(v_lines_sum - ROUND(p_declared_total, 2));
  v_matched   := v_delta = 0;  -- tolerancia cero: cualquier diferencia es descalce

  -- ── Generar correlativo ────────────────────────────────────────────────────
  SELECT fn_next_branch_supply_id() INTO v_receipt_number;

  -- ── INSERT: cabecera ───────────────────────────────────────────────────────
  INSERT INTO branch_supply_receipts (
    receipt_number,
    school_id,          supplier_id,       submitted_by,
    doc_type,           doc_number,        declared_total,
    prices_include_igv, notes,             evidence_path,
    match_score,        status,            replaces_receipt_id,
    submitted_at,       updated_at
  )
  VALUES (
    v_receipt_number,
    p_school_id,        p_supplier_id,     v_caller_id,
    p_doc_type,
    NULLIF(trim(COALESCE(p_doc_number,   '')), ''),
    ROUND(p_declared_total, 2),
    COALESCE(p_prices_include_igv, false),
    NULLIF(trim(COALESCE(p_notes,        '')), ''),
    NULLIF(trim(COALESCE(p_evidence_path,'')), ''),
    jsonb_build_object(
      'lines_sum',      v_lines_sum,
      'declared_total', ROUND(p_declared_total, 2),
      'matched',        v_matched,
      'delta_cents',    ROUND(v_delta * 100, 2)
    ),
    'pending',
    p_replaces_receipt_id,
    clock_timestamp(),  clock_timestamp()
  )
  RETURNING id INTO v_receipt_id;

  -- ── INSERT: ítems ──────────────────────────────────────────────────────────
  v_sort_order := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);
    v_uom_id     := NULLIF(trim(COALESCE(v_item->>'uom_id', '')), '')::uuid;

    INSERT INTO branch_supply_receipt_items (
      receipt_id, product_id, quantity, unit_cost, uom_id, sort_order
    )
    VALUES (v_receipt_id, v_product_id, v_quantity, v_unit_cost, v_uom_id, v_sort_order);

    v_sort_order := v_sort_order + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',             true,
    'receipt_id',     v_receipt_id,
    'receipt_number', v_receipt_number,
    'lines_sum',      v_lines_sum,
    'declared_total', ROUND(p_declared_total, 2),
    'matched',        v_matched,
    'delta_cents',    ROUND(v_delta * 100, 2),
    -- Aviso visible en la UI si hay descalce (el auditor lo verá en el panel)
    'warning', CASE
      WHEN NOT v_matched
        THEN format(
          'DESCALCE_FINANCIERO: Suma de ítems S/ %s ≠ total declarado S/ %s. '
          'Diferencia: S/ %s. El Administrador General verá esta alerta en el panel de auditoría.',
          v_lines_sum, ROUND(p_declared_total, 2), ROUND(v_delta, 2)
        )
      WHEN p_evidence_path IS NULL
        THEN 'SIN_EVIDENCIA: No subiste la foto o PDF del comprobante. El auditor lo verá.'
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_branch_supply_receipt(uuid,uuid,text,text,numeric,boolean,text,text,jsonb,uuid)
  TO authenticated;

SELECT 'OK: submit_branch_supply_receipt creado' AS resultado;

-- ── 8. RPC: preview_branch_supply_totals ─────────────────────────────────────
-- Cálculo server-side PURO, sin persistir nada.
-- El frontend llama este RPC al editar el formulario para mostrar preview
-- informativo de suma vs declarado. Prohibido usarlo para decisiones financieras
-- definitivas: la verdad es el match_score guardado en la cabecera.

CREATE OR REPLACE FUNCTION public.preview_branch_supply_totals(
  p_declared_total numeric,
  p_items          jsonb   -- [{quantity, unit_cost}] — solo necesita esos dos campos
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE                     -- no escribe, PostgreSQL puede cachear en la misma transacción
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines_sum numeric := 0;
  v_item      jsonb;
  v_delta     numeric;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS value
  LOOP
    v_lines_sum := v_lines_sum
      + GREATEST(COALESCE((v_item->>'quantity')::integer, 0), 0)
        * GREATEST(COALESCE((v_item->>'unit_cost')::numeric, 0), 0);
  END LOOP;

  v_lines_sum := ROUND(v_lines_sum, 2);
  v_delta     := ABS(v_lines_sum - ROUND(COALESCE(p_declared_total, 0), 2));

  RETURN jsonb_build_object(
    'lines_sum',      v_lines_sum,
    'declared_total', ROUND(COALESCE(p_declared_total, 0), 2),
    'matched',        v_delta = 0,
    'delta_cents',    ROUND(v_delta * 100, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_branch_supply_totals(numeric, jsonb)
  TO authenticated;

SELECT 'OK: preview_branch_supply_totals creado' AS resultado;

-- ── 9. RPC: approve_branch_supply_receipt ────────────────────────────────────
-- MOTOR ATÓMICO DE APROBACIÓN.
--
-- GARANTÍAS:
--   1. SELECT … FOR UPDATE: candado de concurrencia, previene doble aprobación
--   2. Revalidación de match score en servidor (no confía en valor guardado)
--   3. Revalida que productos sigan activos (puede haber pasado tiempo)
--   4. Llama increment_product_stock por cada ítem → un solo cerebro de stock
--   5. Si cualquier paso falla → ROLLBACK TOTAL (atomicidad garantizada)
--   6. Solo si todo termina bien → COMMIT: stock y Kardex se actualizan juntos

DROP FUNCTION IF EXISTS public.approve_branch_supply_receipt(uuid);

CREATE OR REPLACE FUNCTION public.approve_branch_supply_receipt(
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_receipt     branch_supply_receipts%ROWTYPE;
  v_item        branch_supply_receipt_items%ROWTYPE;
  v_lines_sum   numeric := 0;
  v_delta       numeric;
  v_items_count integer := 0;
  v_rpc_result  jsonb;
BEGIN
  v_caller_id := auth.uid();

  -- ── MURALLA: solo admin_general puede aprobar ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id   = v_caller_id
      AND role IN ('admin_general','superadmin')
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo el Administrador General puede aprobar comprobantes de sede.';
  END IF;

  -- ── CANDADO DE CONCURRENCIA ────────────────────────────────────────────────
  -- SELECT … FOR UPDATE: si otro admin aprueba el mismo comprobante al mismo
  -- tiempo, el segundo intento espera hasta que el primero termine y luego
  -- falla limpio con ALREADY_PROCESSED (idempotencia garantizada).
  SELECT * INTO v_receipt
  FROM   branch_supply_receipts
  WHERE  id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND: El comprobante % no existe.', p_receipt_id;
  END IF;

  -- ── IDEMPOTENCIA: bloquear si ya fue procesado ─────────────────────────────
  IF v_receipt.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_PROCESSED: El comprobante ya fue procesado (estado: %). '
      'No se puede aprobar dos veces. Recargue la lista.', v_receipt.status;
  END IF;

  -- ── REVALIDACIÓN DEL MATCH SCORE (en servidor, no confiar en caché) ────────
  -- Suma los ítems tal como están en BD en este momento
  SELECT
    COALESCE(ROUND(SUM(quantity * unit_cost), 2), 0),
    COUNT(*)
  INTO v_lines_sum, v_items_count
  FROM branch_supply_receipt_items
  WHERE receipt_id = p_receipt_id;

  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'EMPTY_RECEIPT: El comprobante no tiene ítems. No puede ser aprobado.';
  END IF;

  v_delta := ABS(v_lines_sum - ROUND(v_receipt.declared_total, 2));

  -- BLOQUEO DESTRUCTIVO: cualquier descalce (>= 1 céntimo) cancela la aprobación
  IF v_delta > 0 THEN
    RAISE EXCEPTION
      'MATCH_SCORE_FAIL: Descalce financiero detectado. '
      'Suma de ítems: S/ %. Total declarado: S/ %. Diferencia: S/ %. '
      'Corrige el comprobante antes de aprobar.',
      v_lines_sum,
      ROUND(v_receipt.declared_total, 2),
      ROUND(v_delta, 2);
  END IF;

  -- ── SUPRIMIR TRIGGER GENÉRICO DE KARDEX ───────────────────────────────────
  -- increment_product_stock gestiona pos_stock_movements directamente;
  -- este set_config evita que un trigger externo de ajuste_manual duplique el movimiento.
  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- ── MOTOR ATÓMICO: incrementar stock por cada ítem ────────────────────────
  -- Orden determinista por sort_order para consistencia en logs.
  FOR v_item IN
    SELECT * FROM branch_supply_receipt_items
    WHERE  receipt_id = p_receipt_id
    ORDER  BY sort_order
  LOOP
    -- Revalidar que el producto siga activo al momento de aprobar
    -- (puede haberse desactivado entre submit y approve)
    IF NOT EXISTS (
      SELECT 1 FROM products
      WHERE id = v_item.product_id AND active = true
    ) THEN
      RAISE EXCEPTION
        'PRODUCT_INACTIVE: El producto % fue desactivado después de registrar el comprobante. '
        'Rechaza el comprobante y pide a la sede que lo corrija.', v_item.product_id;
    END IF;

    -- increment_product_stock (única función que modifica product_stock):
    --   • Convierte UoM → unidades base EN LA BD (Regla #11.A)
    --   • Hace upsert atómico en product_stock
    --   • Activa is_enabled=true en la fila de stock (fix reactivación)
    --   • Escribe entrada_compra en pos_stock_movements (Kardex)
    --   • Amarra el movimiento al receipt_id vía p_entry_id
    SELECT public.increment_product_stock(
      v_item.product_id,              -- p_product_id
      v_receipt.school_id,            -- p_school_id
      v_item.quantity,                -- p_quantity (en UoM o unidades base)
      p_receipt_id,                   -- p_entry_id → trazabilidad Kardex
      format(
        'Suministro sede — %s %s (Aprobado: %s)',
        v_receipt.doc_type,
        COALESCE(v_receipt.doc_number, 'sin número'),
        v_receipt.receipt_number
      ),
      v_item.uom_id                   -- p_uom_id: NULL = unidades base
    ) INTO v_rpc_result;
  END LOOP;

  -- ── ACTUALIZAR CABECERA: status + auditoría ────────────────────────────────
  UPDATE branch_supply_receipts
  SET
    status      = 'approved',
    reviewed_by = v_caller_id,
    reviewed_at = clock_timestamp(),
    updated_at  = clock_timestamp(),
    -- Sobrescribir match_score con el valor revalidado en este momento
    match_score = jsonb_build_object(
      'lines_sum',      v_lines_sum,
      'declared_total', v_receipt.declared_total,
      'matched',        true,
      'delta_cents',    0,
      'approved_at',    clock_timestamp()
    )
  WHERE id = p_receipt_id;

  -- ── AUDIT LOG ─────────────────────────────────────────────────────────────
  INSERT INTO audit_logs (
    admin_user_id,
    action,
    details,
    target_user_id,
    "timestamp",
    created_at
  )
  VALUES (
    v_caller_id,
    'approve_branch_supply_receipt',
    format(
      'Comprobante %s (%s) aprobado. Tipo: %s. Número: %s. '
      'Total S/ %s. Sede: %s. Ítems: %s.',
      p_receipt_id,
      v_receipt.receipt_number,
      v_receipt.doc_type,
      COALESCE(v_receipt.doc_number, 'sin número'),
      v_receipt.declared_total,
      v_receipt.school_id,
      v_items_count
    ),
    v_receipt.submitted_by,
    clock_timestamp(),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'ok',             true,
    'receipt_id',     p_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'items_approved', v_items_count,
    'lines_sum',      v_lines_sum,
    'declared_total', v_receipt.declared_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_branch_supply_receipt(uuid)
  TO authenticated;

SELECT 'OK: approve_branch_supply_receipt creado' AS resultado;

-- ── 10. RPC: reject_branch_supply_receipt ─────────────────────────────────────
-- Rechazo con motivo obligatorio. NO toca stock en ninguna circunstancia.

DROP FUNCTION IF EXISTS public.reject_branch_supply_receipt(uuid, text);

CREATE OR REPLACE FUNCTION public.reject_branch_supply_receipt(
  p_receipt_id       uuid,
  p_rejection_reason text    -- OBLIGATORIO: motivo legible para la sede
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_receipt   branch_supply_receipts%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();

  -- MURALLA: solo admin_general puede rechazar
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id   = v_caller_id
      AND role IN ('admin_general','superadmin')
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo el Administrador General puede rechazar comprobantes.';
  END IF;

  -- Motivo no puede ser vacío
  IF p_rejection_reason IS NULL OR trim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'VALIDATION: El motivo de rechazo es obligatorio. '
      'Escribe una explicación clara para que la sede pueda corregir el comprobante.';
  END IF;

  -- Candado de concurrencia
  SELECT * INTO v_receipt
  FROM   branch_supply_receipts
  WHERE  id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND: El comprobante % no existe.', p_receipt_id;
  END IF;

  IF v_receipt.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_PROCESSED: El comprobante ya fue procesado (estado: %). '
      'No se puede rechazar dos veces.', v_receipt.status;
  END IF;

  -- Actualizar sin tocar stock
  UPDATE branch_supply_receipts
  SET
    status           = 'rejected',
    reviewed_by      = v_caller_id,
    reviewed_at      = clock_timestamp(),
    rejection_reason = trim(p_rejection_reason),
    updated_at       = clock_timestamp()
  WHERE id = p_receipt_id;

  -- Audit log
  INSERT INTO audit_logs (
    admin_user_id, action, details, target_user_id, "timestamp", created_at
  )
  VALUES (
    v_caller_id,
    'reject_branch_supply_receipt',
    format(
      'Comprobante %s (%s) rechazado. Motivo: %s. Tipo: %s. Número: %s. Sede: %s.',
      p_receipt_id,
      v_receipt.receipt_number,
      trim(p_rejection_reason),
      v_receipt.doc_type,
      COALESCE(v_receipt.doc_number, 'sin número'),
      v_receipt.school_id
    ),
    v_receipt.submitted_by,
    clock_timestamp(),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'receipt_id',      p_receipt_id,
    'receipt_number',  v_receipt.receipt_number,
    'rejection_reason', trim(p_rejection_reason)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_branch_supply_receipt(uuid, text)
  TO authenticated;

SELECT 'OK: reject_branch_supply_receipt creado' AS resultado;

-- ── 11. RPC: get_branch_supply_receipt_detail ──────────────────────────────────
-- Devuelve cabecera + ítems + proveedor + sede en un solo JSON.
-- Minimiza round-trips para el panel de auditoría split-screen.

DROP FUNCTION IF EXISTS public.get_branch_supply_receipt_detail(uuid);

CREATE OR REPLACE FUNCTION public.get_branch_supply_receipt_detail(
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_receipt   branch_supply_receipts%ROWTYPE;
  v_result    jsonb;
BEGIN
  v_caller_id := auth.uid();

  SELECT * INTO v_receipt FROM branch_supply_receipts WHERE id = p_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND: El comprobante % no existe.', p_receipt_id;
  END IF;

  -- Verificar acceso: sede propia o admin_general
  IF NOT (
    v_receipt.school_id IN (SELECT school_id FROM profiles WHERE id = v_caller_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND role IN ('admin_general','superadmin'))
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No tienes acceso a este comprobante.';
  END IF;

  SELECT jsonb_build_object(
    'receipt',  to_jsonb(v_receipt),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                bsri.id,
          'product_id',        bsri.product_id,
          'product_name',      p.name,
          'product_code',      p.code,
          'quantity',          bsri.quantity,
          'unit_cost',         bsri.unit_cost,
          'line_total',        ROUND(bsri.quantity * bsri.unit_cost, 2),
          'uom_id',            bsri.uom_id,
          'uom_name',          pkg.uom_name,
          'conversion_factor', pkg.conversion_factor,
          'sort_order',        bsri.sort_order
        ) ORDER BY bsri.sort_order
      )
      FROM branch_supply_receipt_items bsri
      LEFT JOIN products         p   ON p.id   = bsri.product_id
      LEFT JOIN product_packaging pkg ON pkg.id = bsri.uom_id
      WHERE bsri.receipt_id = p_receipt_id
    ),
    'supplier', (
      SELECT jsonb_build_object(
        'id', s.id, 'name', s.name, 'ruc', s.ruc,
        'contact_person', s.contact_person, 'phone', s.phone
      )
      FROM suppliers s WHERE s.id = v_receipt.supplier_id
    ),
    'school', (
      SELECT jsonb_build_object('id', sc.id, 'name', sc.name)
      FROM schools sc WHERE sc.id = v_receipt.school_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_branch_supply_receipt_detail(uuid)
  TO authenticated;

SELECT 'OK: get_branch_supply_receipt_detail creado' AS resultado;

-- ── 12. VISTA: v_branch_supply_receipts_summary ───────────────────────────────
-- Vista desnormalizada para listar comprobantes en ambos paneles (sede y auditoría).
-- security_invoker=true: hereda el RLS del usuario que la consulta.
-- Si PostgreSQL < 15 no soporta security_invoker, usar consulta directa a la tabla.

CREATE OR REPLACE VIEW public.v_branch_supply_receipts_summary
WITH (security_invoker = true) AS
SELECT
  bsr.id,
  bsr.receipt_number,
  bsr.school_id,
  s.name                                       AS school_name,
  bsr.supplier_id,
  sup.name                                     AS supplier_name,
  sup.ruc                                      AS supplier_ruc,
  bsr.submitted_by,
  bsr.doc_type,
  bsr.doc_number,
  bsr.declared_total,
  bsr.prices_include_igv,
  bsr.evidence_path,
  (bsr.match_score->>'matched')::boolean       AS match_matched,
  (bsr.match_score->>'delta_cents')::numeric   AS match_delta_cents,
  (bsr.match_score->>'lines_sum')::numeric     AS match_lines_sum,
  bsr.status,
  bsr.notes,
  bsr.reviewed_by,
  bsr.reviewed_at,
  bsr.rejection_reason,
  bsr.replaces_receipt_id,
  bsr.submitted_at,
  bsr.updated_at,
  COUNT(bsri.id)                               AS items_count,
  -- Suma persistida en ítems (para display rápido sin JOIN pesado)
  COALESCE(
    ROUND(SUM(bsri.quantity * bsri.unit_cost), 2),
    0
  )                                            AS items_sum_live
FROM public.branch_supply_receipts bsr
LEFT JOIN public.schools   s   ON s.id   = bsr.school_id
LEFT JOIN public.suppliers sup ON sup.id = bsr.supplier_id
LEFT JOIN public.branch_supply_receipt_items bsri ON bsri.receipt_id = bsr.id
GROUP BY
  bsr.id, bsr.receipt_number, bsr.school_id, s.name,
  bsr.supplier_id, sup.name, sup.ruc;

COMMENT ON VIEW public.v_branch_supply_receipts_summary IS
  'Vista desnormalizada de comprobantes de suministro de sede. '
  'security_invoker=true: respeta el RLS del usuario que consulta. '
  'Para el panel split-screen usar get_branch_supply_receipt_detail() que incluye ítems completos.';

SELECT 'OK: v_branch_supply_receipts_summary creada' AS resultado;

-- ── 13. STORAGE: bucket branch_supply_evidence + RLS ─────────────────────────
-- Bucket PRIVADO dedicado. Separado de:
--   • logistic_documents (guías y PDFs de logística central — admin_general only)
--   • vouchers           (comprobantes de pago de padres — público)
-- Convención de paths: {school_id}/{receipt_id}/{timestamp}_{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branch_supply_evidence',
  'branch_supply_evidence',
  false,      -- PRIVADO: solo URLs firmadas (createSignedUrl), nunca URLs públicas
  15728640,   -- 15 MB: soporta facturas PDF escaneadas en alta calidad
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 15728640,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'application/pdf'
  ];

-- Limpiar políticas previas (idempotencia)
DROP POLICY IF EXISTS "bse_insert_own_school"    ON storage.objects;
DROP POLICY IF EXISTS "bse_select_own_school"    ON storage.objects;
DROP POLICY IF EXISTS "bse_select_admin_general" ON storage.objects;
DROP POLICY IF EXISTS "bse_delete_admin_general" ON storage.objects;

-- INSERT: la sede solo puede subir archivos a su propio prefijo {school_id}/
-- El path en el cliente DEBE construirse como: {school_id}/{receipt_id}/{file}
CREATE POLICY "bse_insert_own_school"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'branch_supply_evidence'
    AND (
      -- Admin sede: el primer segmento del path es su school_id
      split_part(name, '/', 1) IN (
        SELECT school_id::text FROM public.profiles WHERE id = auth.uid()
      )
      -- Admin general: puede subir en cualquier path del bucket
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id   = auth.uid()
          AND role IN ('admin_general','superadmin')
      )
    )
  );

-- SELECT: la sede ve solo los archivos de su propio {school_id}/
CREATE POLICY "bse_select_own_school"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'branch_supply_evidence'
    AND split_part(name, '/', 1) IN (
      SELECT school_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

-- SELECT override: admin_general y superadmin ven TODO el bucket
-- (necesario para el panel de auditoría dual en Logística)
CREATE POLICY "bse_select_admin_general"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'branch_supply_evidence'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role IN ('admin_general','superadmin')
    )
  );

-- DELETE: solo admin_general puede borrar evidencias
-- (para corregir subidas erróneas; toda eliminación queda en audit_logs)
CREATE POLICY "bse_delete_admin_general"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'branch_supply_evidence'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id   = auth.uid()
        AND role IN ('admin_general','superadmin')
    )
  );

SELECT 'OK: bucket branch_supply_evidence creado con RLS scoped' AS resultado;

-- ── 14. REGISTRO DE PERMISO: logistica.auditar_comprobantes_sede ─────────────
-- Inserta la acción en la tabla permissions y la asigna a admin_general.
-- Idempotente: ON CONFLICT DO NOTHING + DO UPDATE según el caso.
-- La acción en AccessControlModuleV2.tsx se agrega en el siguiente paso
-- (paso de código React, posterior a este SQL).

DO $$
DECLARE
  v_permission_id uuid;
BEGIN
  -- Insertar el permiso en la tabla permissions
  INSERT INTO public.permissions (module, action, name, description, created_at)
  VALUES (
    'logistica',
    'auditar_comprobantes_sede',
    'Auditar comprobantes de suministros de sedes',
    'Ver panel dual de auditoría, aprobar y rechazar comprobantes de ingreso de sedes',
    clock_timestamp()
  )
  ON CONFLICT (module, action)
  DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description
  RETURNING id INTO v_permission_id;

  -- Si el conflict hizo UPDATE, obtener el id existente
  IF v_permission_id IS NULL THEN
    SELECT id INTO v_permission_id
    FROM public.permissions
    WHERE module = 'logistica' AND action = 'auditar_comprobantes_sede';
  END IF;

  -- Asignar a admin_general (siempre tiene acceso total)
  INSERT INTO public.role_permissions (role, permission_id, granted, created_at)
  VALUES ('admin_general', v_permission_id, true, clock_timestamp())
  ON CONFLICT (role, permission_id)
  DO UPDATE SET granted = true;

  -- Asignar a superadmin también
  INSERT INTO public.role_permissions (role, permission_id, granted, created_at)
  VALUES ('superadmin', v_permission_id, true, clock_timestamp())
  ON CONFLICT (role, permission_id)
  DO UPDATE SET granted = true;

  RAISE NOTICE 'OK: Permiso logistica.auditar_comprobantes_sede registrado. ID: %', v_permission_id;

EXCEPTION
  WHEN undefined_column THEN
    -- La tabla permissions podría no tener columna 'name' en algunas instalaciones
    -- Intentar sin esa columna
    RAISE NOTICE 'FALLBACK: Insertando permission sin columna name...';
    INSERT INTO public.permissions (module, action, description, created_at)
    VALUES (
      'logistica', 'auditar_comprobantes_sede',
      'Ver panel dual de auditoría, aprobar y rechazar comprobantes de sedes',
      clock_timestamp()
    )
    ON CONFLICT (module, action) DO NOTHING
    RETURNING id INTO v_permission_id;

    IF v_permission_id IS NOT NULL THEN
      INSERT INTO public.role_permissions (role, permission_id, granted, created_at)
      VALUES ('admin_general', v_permission_id, true, clock_timestamp())
      ON CONFLICT (role, permission_id) DO UPDATE SET granted = true;
    END IF;
END;
$$;

SELECT 'OK: permiso logistica.auditar_comprobantes_sede registrado' AS resultado;

-- ── VERIFICACIÓN FINAL ────────────────────────────────────────────────────────

SELECT
  'branch_supply_receipts'      AS tabla,
  COUNT(*)                      AS filas_actuales
FROM public.branch_supply_receipts

UNION ALL

SELECT
  'branch_supply_receipt_items' AS tabla,
  COUNT(*)                      AS filas_actuales
FROM public.branch_supply_receipt_items

UNION ALL

SELECT
  'permiso logistica.auditar_comprobantes_sede' AS tabla,
  COUNT(*)                                       AS filas_actuales
FROM public.permissions
WHERE module = 'logistica' AND action = 'auditar_comprobantes_sede';

SELECT '✅ MIGRACIÓN 20260601_branch_supply_module COMPLETADA' AS resultado;
