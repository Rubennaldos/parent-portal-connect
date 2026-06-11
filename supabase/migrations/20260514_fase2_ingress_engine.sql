-- ============================================================
-- FASE 2 — Motor de Ingresos: Auditoría, Costos y Búsqueda Pro
-- ============================================================
-- ADITIVO: cero modificaciones destructivas sobre tablas existentes.
--
-- Bloque 1: Correlativo seguro ING-YYYY-XXXX (tabla de contadores por año)
-- Bloque 2: inventory_transactions  (cabecera auditable de cada ingreso)
-- Bloque 3: inventory_transaction_items  (detalle de productos por ingreso)
-- Bloque 4: product_cost_history  (memoria de costos por producto)
-- Bloque 5: app_settings → warehouse_school_id  (almacén central configurable)
-- Bloque 6: RPC process_ingress_bulk  (motor atómico único de ingreso)
-- Bloque 7: RPC search_products_pro   (buscador con último costo)
-- Bloque 8: RPC create_product_fast   (fast-track de producto)
-- ============================================================

-- ── Bloque 1: Generador de correlativo ING-YYYY-XXXX ─────────────────────────
-- Usamos una tabla-contador por año para reinicio anual seguro y sin deadlocks.
-- ON CONFLICT DO UPDATE con RETURNING es atómico bajo concurrencia.

CREATE TABLE IF NOT EXISTS seq_ingress_by_year (
  year     integer PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE seq_ingress_by_year IS
  'Contador anual para correlativo ING-YYYY-XXXX. Reinicio automático cada año.';

-- Solo admin_general puede leer la tabla de secuencias (lectura interna, no expuesta a UI)
ALTER TABLE seq_ingress_by_year ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seq_ingress_select_admin" ON seq_ingress_by_year;
CREATE POLICY "seq_ingress_select_admin" ON seq_ingress_by_year
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

CREATE OR REPLACE FUNCTION fn_next_ingress_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM timezone('America/Lima', now()))::integer;
  v_seq  integer;
BEGIN
  INSERT INTO seq_ingress_by_year (year, last_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_seq = seq_ingress_by_year.last_seq + 1
  RETURNING last_seq INTO v_seq;

  -- Formato: ING-2026-0001 (4 dígitos → 9999 ingresos/año; ampliar el LPAD si se necesita más)
  RETURN 'ING-' || v_year::text || '-' || LPAD(v_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION fn_next_ingress_id() TO authenticated, service_role;

SELECT 'OK: fn_next_ingress_id y seq_ingress_by_year creados' AS resultado;

-- ── Bloque 2: inventory_transactions ─────────────────────────────────────────
-- Cabecera auditable de cada ingreso de proveedor.
-- Punto de enlace entre: documento proveedor ↔ stock ↔ kardex ↔ costo histórico.

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  internal_transaction_id text       NOT NULL UNIQUE,        -- ING-YYYY-XXXX
  vendor_doc_number      text,                               -- factura/boleta del proveedor
  doc_type               text        NOT NULL DEFAULT 'factura'
    CHECK (doc_type IN ('boleta', 'factura', 'guia')),
  supplier_id            uuid        REFERENCES suppliers(id) ON DELETE RESTRICT,
  is_warehouse_only      boolean     NOT NULL DEFAULT false,  -- true = 100% al almacén
  warehouse_school_id    uuid        REFERENCES schools(id)  ON DELETE SET NULL,
  evidence_url           text,                               -- NULLABLE: opcional
  total_amount           numeric(12,2) NOT NULL DEFAULT 0
    CHECK (total_amount >= 0),
  status                 text        NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'pending', 'cancelled')),
  notes                  text,
  created_by             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Índice para anti-duplicado operativo: mismo proveedor + mismo documento
-- (solo activos; cancelados pueden re-ingresarse)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invtx_supplier_doc_active
  ON inventory_transactions (supplier_id, vendor_doc_number)
  WHERE vendor_doc_number IS NOT NULL
    AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_invtx_created_at
  ON inventory_transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invtx_supplier
  ON inventory_transactions (supplier_id, created_at DESC);

COMMENT ON TABLE inventory_transactions IS
  'Cabecera auditable de cada ingreso de mercadería. Doble correlativo: internal_transaction_id (interno) + vendor_doc_number (proveedor).';
COMMENT ON COLUMN inventory_transactions.internal_transaction_id IS
  'Correlativo interno del sistema (ING-YYYY-XXXX). Generado automáticamente.';
COMMENT ON COLUMN inventory_transactions.vendor_doc_number IS
  'Número de factura/boleta/guía del proveedor. Opcional pero recomendado.';
COMMENT ON COLUMN inventory_transactions.evidence_url IS
  'URL a foto o PDF del comprobante. Nullable: no bloquea la operación en emergencia.';

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invtx_read_admin"  ON inventory_transactions;
DROP POLICY IF EXISTS "invtx_write_admin" ON inventory_transactions;

CREATE POLICY "invtx_read_admin" ON inventory_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

CREATE POLICY "invtx_write_admin" ON inventory_transactions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

SELECT 'OK: inventory_transactions creada' AS resultado;

-- ── Bloque 3: inventory_transaction_items ─────────────────────────────────────
-- Detalle de productos por ingreso (totales; el desglose por sede está en el Kardex).

CREATE TABLE IF NOT EXISTS inventory_transaction_items (
  id             uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id uuid         NOT NULL
    REFERENCES inventory_transactions(id) ON DELETE CASCADE,
  product_id     uuid         NOT NULL
    REFERENCES products(id) ON DELETE RESTRICT,
  total_quantity integer      NOT NULL CHECK (total_quantity > 0),
  unit_cost      numeric(12,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  uom_id         uuid         REFERENCES product_packaging(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invtx_items_tx      ON inventory_transaction_items (transaction_id);
CREATE INDEX IF NOT EXISTS idx_invtx_items_product ON inventory_transaction_items (product_id);

ALTER TABLE inventory_transaction_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invtx_items_read_admin"  ON inventory_transaction_items;
DROP POLICY IF EXISTS "invtx_items_write_admin" ON inventory_transaction_items;

CREATE POLICY "invtx_items_read_admin" ON inventory_transaction_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

CREATE POLICY "invtx_items_write_admin" ON inventory_transaction_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

SELECT 'OK: inventory_transaction_items creada' AS resultado;

-- ── Bloque 4: product_cost_history ───────────────────────────────────────────
-- Memoria histórica de costos por producto.
-- Se inserta en el mismo commit que el ingreso → si falla el costo, falla todo.

CREATE TABLE IF NOT EXISTS product_cost_history (
  id             uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id     uuid         NOT NULL REFERENCES products(id)                ON DELETE CASCADE,
  transaction_id uuid         REFERENCES inventory_transactions(id)           ON DELETE SET NULL,
  unit_cost      numeric(12,4) NOT NULL CHECK (unit_cost >= 0),
  currency       text         NOT NULL DEFAULT 'PEN',
  effective_at   timestamptz  NOT NULL DEFAULT clock_timestamp(),
  created_by     uuid         REFERENCES auth.users(id)                       ON DELETE SET NULL
);

-- Índice crítico: recuperar el último costo de un producto en microsegundos
CREATE INDEX IF NOT EXISTS idx_pch_product_date
  ON product_cost_history (product_id, effective_at DESC);

COMMENT ON TABLE product_cost_history IS
  'Memoria de costos unitarios por producto. Se puebla con cada ingreso de proveedor.';
COMMENT ON COLUMN product_cost_history.unit_cost IS
  'Costo unitario en unidades base (sin UoM, ya convertido). Fuente para sugerencia en formulario de ingreso.';

ALTER TABLE product_cost_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pch_read_admin"  ON product_cost_history;
DROP POLICY IF EXISTS "pch_write_admin" ON product_cost_history;

CREATE POLICY "pch_read_admin" ON product_cost_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

CREATE POLICY "pch_write_admin" ON product_cost_history
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id   = auth.uid()
        AND role = 'admin_general'
    )
  );

SELECT 'OK: product_cost_history creada' AS resultado;

-- ── Bloque 5: warehouse_school_id en app_settings ─────────────────────────────

INSERT INTO app_settings (key, value, description)
VALUES (
  'warehouse_school_id',
  '{"school_id": null}'::jsonb,
  'UUID de la sede que actúa como Almacén Central. Configurable por admin_general.'
)
ON CONFLICT (key) DO NOTHING;

SELECT 'OK: warehouse_school_id registrado en app_settings' AS resultado;

-- ── Bloque 6: RPC process_ingress_bulk ───────────────────────────────────────
-- Motor atómico único de ingreso de mercadería.
--
-- Contrato de datos:
--   p_supplier_id         uuid          REQUERIDO
--   p_vendor_doc_number   text          número de factura del proveedor
--   p_doc_type            text          boleta | factura | guia
--   p_evidence_url        text NULL     foto/PDF (nullable: no bloquea en emergencia)
--   p_notes               text NULL
--   p_is_warehouse_only   boolean       true  → todo al almacén, sin reparto
--                                       false → reparto manual con validación de sumas
--   p_warehouse_school_id uuid NULL     sede almacén (sobrescribe app_settings si se pasa)
--   p_items jsonb:
--     [{
--       product_id:    uuid,
--       total_quantity: integer,    ← total en unidades BASE recibidas
--       unit_cost:     numeric,
--       distribution:  [{school_id: uuid, quantity: integer}]  ← ignorado si warehouse_only
--     }]
--
-- Muralla (RAISE EXCEPTION antes de cualquier INSERT):
--   DUPLICATE_DOC     → mismo proveedor + mismo documento ya existe y está activo
--   VALIDATION        → datos faltantes o inválidos
--   DISTRIBUCION_INVALIDA → suma de sedes ≠ total cuando warehouse_only = false
--
-- Garantía de atomicidad:
--   inventory_transactions + items + product_stock + kardex + cost_history
--   todo en la misma transacción implícita de la función plpgsql.
--   Si falla el costo → rollback total → no queda stock a medias.

DROP FUNCTION IF EXISTS process_ingress_bulk(uuid, text, text, text, text, boolean, uuid, jsonb);

CREATE OR REPLACE FUNCTION process_ingress_bulk(
  p_supplier_id          uuid,
  p_vendor_doc_number    text,
  p_doc_type             text,
  p_evidence_url         text    DEFAULT NULL,
  p_notes                text    DEFAULT NULL,
  p_is_warehouse_only    boolean DEFAULT false,
  p_warehouse_school_id  uuid    DEFAULT NULL,
  p_items                jsonb   DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_tx_id          uuid;
  v_internal_id    text;
  v_total_amount   numeric(12,2) := 0;
  v_wh_school_id   uuid;
  v_item           jsonb;
  v_dist           jsonb;
  v_product_id     uuid;
  v_total_qty      integer;
  v_unit_cost      numeric(12,4);
  v_sum_dist       integer;
  v_product_name   text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no autenticado';
  END IF;

  -- ── Muralla: validaciones de cabecera ─────────────────────────────────────

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: supplier_id es obligatorio. No se puede ingresar sin proveedor.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'VALIDATION: El proveedor indicado no existe en el sistema.';
  END IF;

  IF p_doc_type NOT IN ('boleta', 'factura', 'guia') THEN
    RAISE EXCEPTION 'VALIDATION: doc_type debe ser boleta, factura o guia. Recibido: %', p_doc_type;
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Debe incluir al menos un producto en el ingreso.';
  END IF;

  -- ── Muralla: anti-duplicado por proveedor + documento ─────────────────────
  IF p_vendor_doc_number IS NOT NULL AND trim(p_vendor_doc_number) <> '' THEN
    IF EXISTS (
      SELECT 1
      FROM inventory_transactions
      WHERE supplier_id        = p_supplier_id
        AND vendor_doc_number  = trim(p_vendor_doc_number)
        AND status            <> 'cancelled'
    ) THEN
      RAISE EXCEPTION
        'DUPLICATE_DOC: El documento "%" de este proveedor ya fue registrado y está activo. Si fue un error, cancela el registro anterior primero.',
        trim(p_vendor_doc_number);
    END IF;
  END IF;

  -- ── Resolución del almacén central ───────────────────────────────────────
  IF p_is_warehouse_only THEN
    -- Prioridad: parámetro explícito > app_settings
    v_wh_school_id := p_warehouse_school_id;

    IF v_wh_school_id IS NULL THEN
      SELECT (s.value->>'school_id')::uuid
      INTO   v_wh_school_id
      FROM   app_settings s
      WHERE  s.key = 'warehouse_school_id'
      LIMIT  1;
    END IF;

    IF v_wh_school_id IS NULL THEN
      RAISE EXCEPTION
        'VALIDATION: No hay sede de Almacén Central configurada. Ve a Configuración → Logística para definirla.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM schools WHERE id = v_wh_school_id) THEN
      RAISE EXCEPTION
        'VALIDATION: La sede de Almacén Central configurada no existe en el sistema.';
    END IF;
  END IF;

  -- ── Muralla: validar distribución por producto (cuando no es warehouse-only) ──
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_total_qty  := (v_item->>'total_quantity')::integer;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION: product_id es obligatorio en cada ítem.';
    END IF;

    IF v_total_qty IS NULL OR v_total_qty <= 0 THEN
      RAISE EXCEPTION 'VALIDATION: total_quantity debe ser mayor a 0 para cada producto.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = v_product_id AND p.active = true) THEN
      SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
      RAISE EXCEPTION
        'PRODUCT_NOT_FOUND: El producto "%" no existe o está inactivo.',
        COALESCE(v_product_name, v_product_id::text);
    END IF;

    IF NOT p_is_warehouse_only THEN
      -- Distribución manual: validar existencia y suma
      IF jsonb_array_length(COALESCE(v_item->'distribution', '[]'::jsonb)) = 0 THEN
        SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
        RAISE EXCEPTION
          'VALIDATION: El producto "%" no tiene distribución por sede. Define cuántas unidades van a cada sede.',
          COALESCE(v_product_name, v_product_id::text);
      END IF;

      SELECT COALESCE(SUM((d->>'quantity')::integer), 0)
      INTO   v_sum_dist
      FROM   jsonb_array_elements(v_item->'distribution') d;

      IF v_sum_dist <> v_total_qty THEN
        SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
        RAISE EXCEPTION
          'DISTRIBUCION_INVALIDA: La suma de sedes (%) ≠ total recibido (%) para "%". Ajusta la distribución antes de confirmar.',
          v_sum_dist, v_total_qty, COALESCE(v_product_name, v_product_id::text);
      END IF;

      FOR v_dist IN SELECT value FROM jsonb_array_elements(v_item->'distribution') AS value
      LOOP
        IF (v_dist->>'quantity')::integer <= 0 THEN
          RAISE EXCEPTION 'VALIDATION: Cada cantidad por sede debe ser mayor a 0.';
        END IF;
      END LOOP;
    END IF;

    -- Acumular total de la factura
    v_total_amount := v_total_amount +
      COALESCE((v_item->>'unit_cost')::numeric, 0) * v_total_qty;
  END LOOP;

  -- ── Generar correlativo interno (concurrency-safe) ────────────────────────
  SELECT fn_next_ingress_id() INTO v_internal_id;

  -- ── INSERT: cabecera de la transacción ────────────────────────────────────
  INSERT INTO inventory_transactions (
    internal_transaction_id,
    vendor_doc_number,
    doc_type,
    supplier_id,
    is_warehouse_only,
    warehouse_school_id,
    evidence_url,
    total_amount,
    notes,
    status,
    created_by,
    created_at
  )
  VALUES (
    v_internal_id,
    NULLIF(trim(COALESCE(p_vendor_doc_number, '')), ''),
    p_doc_type,
    p_supplier_id,
    p_is_warehouse_only,
    v_wh_school_id,
    NULLIF(trim(COALESCE(p_evidence_url, '')), ''),
    v_total_amount,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'completed',
    v_caller_id,
    clock_timestamp()
  )
  RETURNING id INTO v_tx_id;

  -- ── Suprimir trigger genérico (Kardex lo maneja increment_product_stock) ──
  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- ── Procesar cada producto ────────────────────────────────────────────────
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_total_qty  := (v_item->>'total_quantity')::integer;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);

    -- Ítem de la transacción (resumen de la factura)
    INSERT INTO inventory_transaction_items (
      transaction_id, product_id, total_quantity, unit_cost
    )
    VALUES (v_tx_id, v_product_id, v_total_qty, v_unit_cost);

    -- Historial de costos (en el mismo commit → si falla, rollback total)
    -- Solo registramos si el costo es > 0 para no contaminar el historial con ceros
    IF v_unit_cost > 0 THEN
      INSERT INTO product_cost_history (
        product_id, transaction_id, unit_cost, created_by
      )
      VALUES (v_product_id, v_tx_id, v_unit_cost, v_caller_id);
    END IF;

    -- Stock: warehouse-only vs distribución por sede
    IF p_is_warehouse_only THEN
      -- Todo va al almacén central
      PERFORM increment_product_stock(
        v_product_id,
        v_wh_school_id,
        v_total_qty,
        v_tx_id,
        format('Ingreso %s — %s %s → Almacén Central',
          v_internal_id, p_doc_type, COALESCE(p_vendor_doc_number, '')),
        NULL
      );
    ELSE
      -- Distribución manual por sede
      FOR v_dist IN SELECT value FROM jsonb_array_elements(v_item->'distribution') AS value
      LOOP
        PERFORM increment_product_stock(
          v_product_id,
          (v_dist->>'school_id')::uuid,
          (v_dist->>'quantity')::integer,
          v_tx_id,
          format('Ingreso %s — %s %s → distribución multisede',
            v_internal_id, p_doc_type, COALESCE(p_vendor_doc_number, '')),
          NULL
        );
      END LOOP;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'ok',                    true,
    'transaction_id',        v_tx_id,
    'internal_transaction_id', v_internal_id,
    'total_amount',          v_total_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_ingress_bulk(uuid, text, text, text, text, boolean, uuid, jsonb)
  TO authenticated, service_role;

SELECT 'OK: process_ingress_bulk creado — motor atómico de ingresos' AS resultado;

-- ── Bloque 7: RPC search_products_pro ─────────────────────────────────────────
-- Buscador inteligente con:
--   • Normalización (f_search_norm_text): sin tildes, sin mayúsculas
--   • Palabra-por-palabra AND: "papa inka" encuentra "Inka Chips Papas Sal"
--   • Fuzzy fallback: trgm similarity para typos ligeros
--   • Autocompletado de costo: devuelve último costo del historial
--   • Sin contexto de sede: sirve para el formulario de ingreso
--
-- Retorna: product_id, name, code, category, active, last_unit_cost, relevance

DROP FUNCTION IF EXISTS search_products_pro(text, integer);

CREATE OR REPLACE FUNCTION search_products_pro(
  p_query  text    DEFAULT NULL,
  p_limit  integer DEFAULT 20
)
RETURNS TABLE (
  product_id     uuid,
  product_name   text,
  product_code   text,
  category       text,
  active         boolean,
  last_unit_cost numeric,
  relevance      real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Normalizar query y dividir en tokens individuales
  q AS (
    SELECT
      f_search_norm_text(trim(COALESCE(p_query, ''))) AS norm,
      array_remove(
        string_to_array(
          regexp_replace(
            f_search_norm_text(trim(COALESCE(p_query, ''))),
            '\s+', ' ', 'g'
          ),
          ' '
        ),
        ''
      ) AS tokens
  ),
  -- Último costo por producto (LATERAL más eficiente que sub-SELECT por fila)
  last_cost AS (
    SELECT DISTINCT ON (pch.product_id)
      pch.product_id,
      pch.unit_cost
    FROM product_cost_history pch
    ORDER BY pch.product_id, pch.effective_at DESC
  )
  SELECT
    p.id                                                AS product_id,
    p.name                                              AS product_name,
    p.code                                              AS product_code,
    COALESCE(NULLIF(trim(p.category), ''), 'Sin categoría') AS category,
    p.active,
    COALESCE(lc.unit_cost, 0)                           AS last_unit_cost,
    CASE
      WHEN array_length(q.tokens, 1) IS NULL OR array_length(q.tokens, 1) = 0
        THEN 1::real
      ELSE
        GREATEST(
          similarity(f_search_norm_text(p.name), q.norm),
          COALESCE(similarity(f_search_norm_text(COALESCE(p.code, '')), q.norm), 0)
        )::real
    END AS relevance
  FROM   products p
  CROSS  JOIN q
  LEFT   JOIN last_cost lc ON lc.product_id = p.id
  WHERE  p.active = true
    AND (
      -- Sin query: devolver todos (hasta el límite)
      array_length(q.tokens, 1) IS NULL
      OR array_length(q.tokens, 1) = 0
      OR (
        -- Todos los tokens deben aparecer en nombre, código o categoría
        -- (búsqueda no lineal: "papa inka" encuentra "Inka Chips Papas")
        NOT EXISTS (
          SELECT 1
          FROM unnest(q.tokens) AS t(token)
          WHERE
            f_search_norm_text(p.name)                        NOT LIKE '%' || t.token || '%'
            AND f_search_norm_text(COALESCE(p.code, ''))      NOT LIKE '%' || t.token || '%'
            AND f_search_norm_text(COALESCE(p.category, ''))  NOT LIKE '%' || t.token || '%'
        )
        -- Fallback fuzzy para queries de una sola palabra (maneja typos)
        OR f_search_norm_text(p.name) % q.norm
      )
    )
  ORDER BY
    relevance DESC,
    p.name    ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

GRANT EXECUTE ON FUNCTION search_products_pro(text, integer)
  TO authenticated, service_role;

SELECT 'OK: search_products_pro creado — buscador inteligente con costo histórico' AS resultado;

-- ── Bloque 8: RPC create_product_fast ────────────────────────────────────────
-- Fast-track para crear un producto básico sin salir del modal de ingreso.
-- Idempotente: si el nombre ya existe, devuelve el producto existente.
-- El admin puede completar precio de venta, código, etc. en el Maestro de Productos.

DROP FUNCTION IF EXISTS create_product_fast(text, text, integer);

CREATE OR REPLACE FUNCTION create_product_fast(
  p_name      text,
  p_category  text    DEFAULT NULL,
  p_min_stock integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id   uuid;
  v_was_existing boolean := false;
BEGIN
  -- Validación mínima
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'VALIDATION: El nombre del producto es obligatorio.';
  END IF;

  -- Idempotencia: nombre normalizado ya existe → devolver existente
  SELECT p.id
  INTO   v_product_id
  FROM   products p
  WHERE  f_search_norm_text(p.name) = f_search_norm_text(p_name)
  LIMIT  1;

  IF FOUND THEN
    v_was_existing := true;
  ELSE
    -- Crear producto básico listo para ingresos
    -- price_sale y price_cost en 0: el responsable los completa en Maestro de Productos
    INSERT INTO products (
      name,
      category,
      min_stock,
      price_sale,
      price_cost,
      active,
      stock_control_enabled
    )
    VALUES (
      trim(p_name),
      NULLIF(trim(COALESCE(p_category, '')), ''),
      COALESCE(p_min_stock, 0),
      0,   -- precio de venta pendiente de configurar
      0,   -- precio de costo pendiente de configurar
      true,
      true -- stock controlado por defecto (producto logístico)
    )
    RETURNING id INTO v_product_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'product_id',   v_product_id,
    'was_existing', v_was_existing,
    'message',      CASE
                      WHEN v_was_existing
                        THEN 'Producto encontrado en el sistema.'
                      ELSE
                        'Producto creado. Recuerda completar precio de venta en el Maestro de Productos.'
                    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_product_fast(text, text, integer)
  TO authenticated, service_role;

SELECT 'OK: create_product_fast creado — fast-track idempotente de producto' AS resultado;

-- ── Índices adicionales para performance ──────────────────────────────────────
-- El índice GIN sobre f_search_norm_text(name) ya existe (20260514_inventory_brain_wall_reengineering.sql).
-- Agregar índice sobre category normalizada para búsqueda por categoría.

CREATE INDEX IF NOT EXISTS idx_products_category_norm_trgm
  ON products
  USING gin (f_search_norm_text(COALESCE(category, '')) gin_trgm_ops);

SELECT 'OK: índice GIN categoría normalizada creado' AS resultado;

SELECT '✅ FASE 2 INGRESS ENGINE: migración completada exitosamente' AS resultado;
