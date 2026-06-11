-- ============================================================
-- MODO RÁPIDO DE INGRESO: Ingreso Interno sin Comprobante
-- Archivo : 20260603_quick_stock_receipt.sql
-- Fecha   : 2026-06-03
--
-- PROPÓSITO:
--   Permite a la sede registrar entrada de mercadería sin
--   proveedor, número de documento, total ni foto.
--   Solo: productos + cantidades + nota opcional.
--   El stock se aplica INMEDIATAMENTE (no requiere auditoría).
--
-- REGLAS DE ORO:
--   • Un solo RPC atómico — cero stock a medias
--   • Correlativo generado en BD (reloj Lima, nunca cliente)
--   • Muralla de validaciones en PostgreSQL (RAISE EXCEPTION)
--   • stock sube vía increment_product_stock (mismo camino que logística)
--   • Auditado en pos_stock_movements por cada ítem
--
-- BLOQUES:
--   1. Hacer supplier_id nullable (retro-compatible; índice parcial ya excluye NULL)
--   2. Agregar columna is_quick
--   3. Corregir CHECK de doc_type para incluir 'interno'
--   4. Agregar CHECK de consistencia (is_quick ↔ supplier_id)
--   5. Recrear vista v_branch_supply_receipts_summary con COALESCE + is_quick
--   6. RPC submit_quick_stock_receipt
-- ============================================================

BEGIN;

-- ── 1. supplier_id → nullable ──────────────────────────────────────────────────
-- El índice único parcial ya tiene "AND supplier_id IS NOT NULL",
-- así que los ingresos rápidos (supplier_id NULL) no chocan con él.

ALTER TABLE public.branch_supply_receipts
  ALTER COLUMN supplier_id DROP NOT NULL;

-- ── 2. Columna is_quick ────────────────────────────────────────────────────────
-- false  = comprobante estándar (flujo de auditoría con Auditor General)
-- true   = ingreso rápido (stock inmediato, sin proveedor ni comprobante)

ALTER TABLE public.branch_supply_receipts
  ADD COLUMN IF NOT EXISTS is_quick boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.branch_supply_receipts.is_quick IS
  'true = ingreso rápido de sede (stock inmediato, sin proveedor ni comprobante físico). '
  'false = comprobante estándar que requiere aprobación del Auditor General.';

-- ── 3. CHECK doc_type: ampliar para incluir ''interno'' ────────────────────────
-- Primero eliminar el CHECK existente detectándolo por contenido.

DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT tc.constraint_name
    INTO v_constraint
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints  cc USING (constraint_name)
   WHERE tc.table_name      = 'branch_supply_receipts'
     AND tc.constraint_type = 'CHECK'
     AND cc.check_clause    LIKE '%doc_type%'
   LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.branch_supply_receipts DROP CONSTRAINT %I', v_constraint);
  END IF;
END;
$$;

ALTER TABLE public.branch_supply_receipts
  ADD CONSTRAINT bsr_doc_type_check
  CHECK (doc_type IN ('boleta', 'factura', 'guia', 'nota_venta', 'interno'));

-- ── 4. CHECK de consistencia is_quick ↔ supplier_id ───────────────────────────
-- Si is_quick = false (modo estándar), supplier_id DEBE estar presente.
-- Si is_quick = true  (modo rápido),  supplier_id DEBE ser NULL.

ALTER TABLE public.branch_supply_receipts
  ADD CONSTRAINT bsr_quick_supplier_consistency
  CHECK (
    (is_quick = false AND supplier_id IS NOT NULL)
    OR
    (is_quick = true  AND supplier_id IS NULL)
  );

SELECT 'OK: tabla branch_supply_receipts ampliada para modo rápido' AS resultado;

-- ── 5. Vista: recrear v_branch_supply_receipts_summary ────────────────────────
-- Cambios respecto a la original:
--   • COALESCE(sup.name, 'Ingreso rápido') para supplier_name
--   • Incluye columna is_quick (al final: CREATE OR REPLACE no permite insertar columnas en medio)
--
-- PostgreSQL exige DROP + CREATE si cambia el orden/posición de columnas de la vista.

DROP VIEW IF EXISTS public.v_branch_supply_receipts_summary;

CREATE VIEW public.v_branch_supply_receipts_summary
WITH (security_invoker = true) AS
SELECT
  bsr.id,
  bsr.receipt_number,
  bsr.school_id,
  s.name                                         AS school_name,
  bsr.supplier_id,
  COALESCE(sup.name, 'Ingreso rápido')           AS supplier_name,
  sup.ruc                                        AS supplier_ruc,
  bsr.submitted_by,
  bsr.doc_type,
  bsr.doc_number,
  bsr.declared_total,
  bsr.prices_include_igv,
  bsr.evidence_path,
  (bsr.match_score->>'matched')::boolean         AS match_matched,
  (bsr.match_score->>'delta_cents')::numeric     AS match_delta_cents,
  (bsr.match_score->>'lines_sum')::numeric       AS match_lines_sum,
  bsr.status,
  bsr.notes,
  bsr.reviewed_by,
  bsr.reviewed_at,
  bsr.rejection_reason,
  bsr.replaces_receipt_id,
  bsr.submitted_at,
  bsr.updated_at,
  COUNT(bsri.id)                                 AS items_count,
  COALESCE(
    ROUND(SUM(bsri.quantity * bsri.unit_cost), 2),
    0
  )                                              AS items_sum_live,
  bsr.is_quick
FROM public.branch_supply_receipts bsr
LEFT JOIN public.schools   s   ON s.id   = bsr.school_id
LEFT JOIN public.suppliers sup ON sup.id  = bsr.supplier_id
LEFT JOIN public.branch_supply_receipt_items bsri ON bsri.receipt_id = bsr.id
GROUP BY
  bsr.id, bsr.receipt_number, bsr.school_id, s.name,
  bsr.supplier_id, sup.name, sup.ruc, bsr.is_quick;

COMMENT ON VIEW public.v_branch_supply_receipts_summary IS
  'Vista desnormalizada de comprobantes de suministro de sede. '
  'is_quick=true: ingresos rápidos (sin proveedor, stock inmediato). '
  'is_quick=false: comprobantes estándar con auditoría del Admin General. '
  'security_invoker=true: respeta el RLS del usuario que consulta.';

SELECT 'OK: v_branch_supply_receipts_summary recreada con is_quick y COALESCE supplier_name' AS resultado;

-- ── 6. RPC: submit_quick_stock_receipt ────────────────────────────────────────
-- Motor atómico del ingreso rápido.
--
-- Contrato:
--   - p_school_id : sede destino del stock
--   - p_items     : [{product_id: uuid, quantity: int, uom_id: uuid|null}]
--   - p_notes     : texto libre opcional
--
-- Garantías:
--   • stock solo sube si TODA la transacción tiene éxito (rollback total)
--   • correlativo generado por fn_next_branch_supply_id() (mismo contador BSR)
--   • cada ítem deja rastro en pos_stock_movements (kardex) como 'entrada_compra'
--   • cero stock en cliente, cero .reduce() fuera de aquí

DROP FUNCTION IF EXISTS public.submit_quick_stock_receipt(uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.submit_quick_stock_receipt(
  p_school_id uuid,
  p_items     jsonb,
  p_notes     text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid;
  v_caller_school uuid;
  v_receipt_id   uuid;
  v_receipt_num  text;
  v_item         jsonb;
  v_product_id   uuid;
  v_quantity     integer;
  v_uom_id       uuid;
  v_product_name text;
  v_sort         smallint := 0;
BEGIN
  -- ── Autenticación ──────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para registrar un ingreso.';
  END IF;

  -- ── Validar acceso a la sede ───────────────────────────────────────────────
  -- Admin general puede registrar en cualquier sede.
  -- Admin sede solo puede registrar en su propia sede.
  SELECT school_id INTO v_caller_school
    FROM profiles WHERE id = v_caller_id;

  IF NOT (
    v_caller_school = p_school_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = v_caller_id
        AND role IN ('admin_general', 'superadmin')
    )
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo puedes registrar ingresos en tu propia sede.';
  END IF;

  -- ── Muralla: validar sede ──────────────────────────────────────────────────
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: Sede no especificada.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schools WHERE id = p_school_id AND is_active = true) THEN
    RAISE EXCEPTION 'VALIDATION: La sede no existe o no está activa.';
  END IF;

  -- ── Muralla: validar ítems ─────────────────────────────────────────────────
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debes incluir al menos un producto.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION: Cada ítem debe tener un producto seleccionado.';
    END IF;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'VALIDATION: La cantidad de cada producto debe ser mayor a 0.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM products WHERE id = v_product_id AND active = true
    ) THEN
      SELECT name INTO v_product_name FROM products WHERE id = v_product_id;
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto "%" no existe o está inactivo.',
        COALESCE(v_product_name, v_product_id::text);
    END IF;
  END LOOP;

  -- ── Generar correlativo (mismo contador BSR, reloj Lima) ───────────────────
  v_receipt_num := fn_next_branch_supply_id();
  v_receipt_id  := gen_random_uuid();

  -- ── Insertar cabecera ──────────────────────────────────────────────────────
  -- is_quick=true, supplier_id=NULL, status='approved' (stock inmediato)
  -- doc_type='interno': valor semánticamente correcto para ingresos sin comprobante
  -- match_score=NULL: no hay comprobante físico que comparar
  INSERT INTO branch_supply_receipts (
    id, receipt_number, school_id, supplier_id, submitted_by,
    doc_type, doc_number, declared_total, prices_include_igv,
    notes, evidence_path, match_score,
    status, reviewed_by, reviewed_at,
    is_quick, submitted_at, updated_at
  ) VALUES (
    v_receipt_id,
    v_receipt_num,
    p_school_id,
    NULL,                          -- sin proveedor
    v_caller_id,
    'interno',                     -- doc_type especial para ingresos rápidos
    NULL,                          -- sin número de documento
    0,                             -- sin monto declarado
    false,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    NULL,                          -- sin evidencia fotográfica
    NULL,                          -- sin match_score (no hay comprobante)
    'approved',                    -- aprobado directamente (stock inmediato)
    v_caller_id,                   -- el que ingresa también es el "revisor"
    clock_timestamp(),
    true,                          -- is_quick = true
    clock_timestamp(),
    clock_timestamp()
  );

  -- ── Insertar ítems + aplicar stock (atómico) ───────────────────────────────
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;
    v_uom_id     := NULLIF(v_item->>'uom_id', '')::uuid;

    INSERT INTO branch_supply_receipt_items (
      receipt_id, product_id, quantity, unit_cost, uom_id, sort_order
    ) VALUES (
      v_receipt_id,
      v_product_id,
      v_quantity,
      0,            -- sin costo (ingreso rápido no registra costos)
      v_uom_id,
      v_sort
    );

    -- increment_product_stock: convierte UoM en BD, actualiza product_stock,
    -- escribe kardex ('entrada_compra') y audita. Rollback total si falla.
    PERFORM increment_product_stock(
      v_product_id,
      p_school_id,
      v_quantity,
      v_receipt_id,
      format('Ingreso rápido %s', v_receipt_num),
      v_uom_id
    );

    v_sort := v_sort + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',             true,
    'receipt_id',     v_receipt_id,
    'receipt_number', v_receipt_num
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_quick_stock_receipt(uuid, jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_quick_stock_receipt IS
  'Ingreso rápido de mercadería para sede: solo productos y cantidades. '
  'El stock sube inmediatamente (status=approved). Sin proveedor, sin comprobante, sin auditoría. '
  'Atómico: si falla cualquier increment_product_stock, se revierte todo.';

SELECT 'OK: submit_quick_stock_receipt creado' AS resultado;

COMMIT;
