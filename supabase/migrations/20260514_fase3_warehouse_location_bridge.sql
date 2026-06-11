-- ============================================================
-- FASE 3 — Puente Almacén Central (ubicación real, no sede)
-- ============================================================
-- Objetivo:
--   1) Modelar Almacén Central como ubicación propia (no school)
--   2) Mantener intacta la lógica actual por sede (product_stock + POS)
--   3) Habilitar traslados sede↔almacén sin romper módulos existentes
-- ============================================================

-- ── 1) Ubicaciones de inventario ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_locations (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  code           text        NOT NULL UNIQUE,
  name           text        NOT NULL,
  location_type  text        NOT NULL CHECK (location_type IN ('warehouse','school')),
  school_id      uuid        UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  is_primary     boolean     NOT NULL DEFAULT false,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_inventory_location_type_school
    CHECK ((location_type = 'school' AND school_id IS NOT NULL) OR (location_type = 'warehouse' AND school_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_locations_primary_wh
  ON inventory_locations (is_primary)
  WHERE location_type = 'warehouse' AND is_primary = true;

ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_locations_read_admin"  ON inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_write_admin" ON inventory_locations;

CREATE POLICY "inventory_locations_read_admin" ON inventory_locations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

CREATE POLICY "inventory_locations_write_admin" ON inventory_locations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin')
    )
  );

-- Semilla: un almacén central por defecto (no depende de schools)
INSERT INTO inventory_locations (code, name, location_type, is_primary)
VALUES ('WH-CENTRAL', 'Almacén Central', 'warehouse', true)
ON CONFLICT (code) DO NOTHING;

-- Semilla: mirror de sedes activas como ubicaciones tipo school
INSERT INTO inventory_locations (code, name, location_type, school_id, is_primary)
SELECT
  'SCH-' || s.id::text,
  s.name,
  'school',
  s.id,
  false
FROM schools s
LEFT JOIN inventory_locations il ON il.school_id = s.id
WHERE il.id IS NULL;

SELECT 'OK: inventory_locations creada y sembrada (warehouse + school mirrors)' AS resultado;

-- ── 2) Stock por ubicación (almacén) ────────────────────────────────────────
-- NOTA: las sedes siguen usando product_stock para no romper POS.
CREATE TABLE IF NOT EXISTS product_stock_locations (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id     uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id    uuid        NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  current_stock  integer     NOT NULL DEFAULT 0,
  last_updated   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(product_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_psl_location ON product_stock_locations (location_id);
CREATE INDEX IF NOT EXISTS idx_psl_product  ON product_stock_locations (product_id);

ALTER TABLE product_stock_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psl_read_admin"  ON product_stock_locations;
DROP POLICY IF EXISTS "psl_write_admin" ON product_stock_locations;

CREATE POLICY "psl_read_admin" ON product_stock_locations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

CREATE POLICY "psl_write_admin" ON product_stock_locations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin')
    )
  );

SELECT 'OK: product_stock_locations creada' AS resultado;

-- ── 3) Movimientos de ubicación (Kardex del almacén) ────────────────────────
CREATE TABLE IF NOT EXISTS inventory_location_movements (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id     uuid        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id    uuid        NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  movement_type  text        NOT NULL CHECK (movement_type IN ('ingress','transfer_in','transfer_out','adjustment')),
  quantity_delta integer     NOT NULL,
  stock_before   integer     NOT NULL,
  stock_after    integer     NOT NULL,
  reference_id   uuid,
  reason         text,
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_ilm_location_date ON inventory_location_movements (location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ilm_product_date  ON inventory_location_movements (product_id,  created_at DESC);

ALTER TABLE inventory_location_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ilm_read_admin"  ON inventory_location_movements;
DROP POLICY IF EXISTS "ilm_write_admin" ON inventory_location_movements;

CREATE POLICY "ilm_read_admin" ON inventory_location_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

CREATE POLICY "ilm_write_admin" ON inventory_location_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

SELECT 'OK: inventory_location_movements creada' AS resultado;

-- ── 4) Helpers de ubicación ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_get_primary_warehouse_location_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  SELECT id
  INTO   v_location_id
  FROM   inventory_locations
  WHERE  location_type = 'warehouse'
    AND  is_primary    = true
    AND  is_active     = true
  LIMIT  1;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_CONFIGURED: No hay Almacén Central activo configurado.';
  END IF;

  RETURN v_location_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_primary_warehouse_location_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION fn_get_school_location_id(p_school_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  SELECT id INTO v_location_id
  FROM inventory_locations
  WHERE school_id = p_school_id
    AND location_type = 'school'
  LIMIT 1;

  IF v_location_id IS NULL THEN
    INSERT INTO inventory_locations (code, name, location_type, school_id, is_primary)
    SELECT 'SCH-' || s.id::text, s.name, 'school', s.id, false
    FROM schools s
    WHERE s.id = p_school_id
    RETURNING id INTO v_location_id;
  END IF;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: No se pudo resolver ubicación para la sede %', p_school_id;
  END IF;

  RETURN v_location_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_school_location_id(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION fn_increment_location_stock(
  p_product_id   uuid,
  p_location_id  uuid,
  p_quantity     integer,
  p_reference_id uuid DEFAULT NULL,
  p_reason       text DEFAULT NULL,
  p_movement_type text DEFAULT 'ingress'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before integer := 0;
  v_after  integer;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad debe ser mayor a 0';
  END IF;

  SELECT COALESCE(current_stock, 0)
  INTO v_before
  FROM product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = p_location_id;

  INSERT INTO product_stock_locations (product_id, location_id, current_stock, last_updated)
  VALUES (p_product_id, p_location_id, p_quantity, clock_timestamp())
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET
    current_stock = product_stock_locations.current_stock + p_quantity,
    last_updated  = clock_timestamp();

  SELECT current_stock INTO v_after
  FROM product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = p_location_id;

  INSERT INTO inventory_location_movements (
    product_id, location_id, movement_type, quantity_delta,
    stock_before, stock_after, reference_id, reason, created_by, created_at
  ) VALUES (
    p_product_id, p_location_id, p_movement_type, p_quantity,
    v_before, v_after, p_reference_id, p_reason, auth.uid(), clock_timestamp()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_increment_location_stock(uuid, uuid, integer, uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION fn_decrement_location_stock(
  p_product_id   uuid,
  p_location_id  uuid,
  p_quantity     integer,
  p_reference_id uuid DEFAULT NULL,
  p_reason       text DEFAULT NULL,
  p_movement_type text DEFAULT 'transfer_out'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before integer := 0;
  v_after  integer;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad debe ser mayor a 0';
  END IF;

  SELECT COALESCE(current_stock, 0)
  INTO v_before
  FROM product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = p_location_id
  FOR UPDATE;

  IF v_before < p_quantity THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: stock insuficiente en almacén. Disponible: %, solicitado: %', v_before, p_quantity;
  END IF;

  UPDATE product_stock_locations
  SET current_stock = current_stock - p_quantity,
      last_updated  = clock_timestamp()
  WHERE product_id = p_product_id
    AND location_id = p_location_id;

  SELECT current_stock INTO v_after
  FROM product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = p_location_id;

  INSERT INTO inventory_location_movements (
    product_id, location_id, movement_type, quantity_delta,
    stock_before, stock_after, reference_id, reason, created_by, created_at
  ) VALUES (
    p_product_id, p_location_id, p_movement_type, -p_quantity,
    v_before, v_after, p_reference_id, p_reason, auth.uid(), clock_timestamp()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_decrement_location_stock(uuid, uuid, integer, uuid, text, text)
  TO authenticated, service_role;

SELECT 'OK: helpers de ubicación creados' AS resultado;

-- ── 5) Proyección de stock del almacén (para UI de salidas) ─────────────────
DROP FUNCTION IF EXISTS get_warehouse_stock_for_products(uuid[]);

CREATE OR REPLACE FUNCTION get_warehouse_stock_for_products(
  p_product_ids uuid[]
)
RETURNS TABLE (
  product_id    uuid,
  current_stock integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH wh AS (
    SELECT fn_get_primary_warehouse_location_id() AS location_id
  )
  SELECT
    p.product_id,
    COALESCE(psl.current_stock, 0) AS current_stock
  FROM (
    SELECT unnest(p_product_ids) AS product_id
  ) p
  CROSS JOIN wh
  LEFT JOIN product_stock_locations psl
    ON psl.product_id  = p.product_id
   AND psl.location_id = wh.location_id;
$$;

GRANT EXECUTE ON FUNCTION get_warehouse_stock_for_products(uuid[])
  TO authenticated, service_role;

SELECT 'OK: get_warehouse_stock_for_products creado' AS resultado;

-- ── 6) Traslados con almacén (sede↔almacén) ─────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_transfer_warehouse_number START 1;

CREATE TABLE IF NOT EXISTS inventory_location_transfers (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_number   text        NOT NULL UNIQUE,
  from_location_id  uuid        NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  to_location_id    uuid        NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  status            text        NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','pending','cancelled')),
  notes             text,
  contact_person    text,
  contact_phone     text,
  approved_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_inventory_location_transfer_diff
    CHECK (from_location_id <> to_location_id)
);

CREATE TABLE IF NOT EXISTS inventory_location_transfer_items (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id  uuid    NOT NULL REFERENCES inventory_location_transfers(id) ON DELETE CASCADE,
  product_id   uuid    NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity     integer NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_ilt_created_at ON inventory_location_transfers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ilt_items_transfer ON inventory_location_transfer_items (transfer_id);

ALTER TABLE inventory_location_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_location_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ilt_read_admin"  ON inventory_location_transfers;
DROP POLICY IF EXISTS "ilt_write_admin" ON inventory_location_transfers;
DROP POLICY IF EXISTS "ilti_read_admin"  ON inventory_location_transfer_items;
DROP POLICY IF EXISTS "ilti_write_admin" ON inventory_location_transfer_items;

CREATE POLICY "ilt_read_admin" ON inventory_location_transfers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

CREATE POLICY "ilt_write_admin" ON inventory_location_transfers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

CREATE POLICY "ilti_read_admin" ON inventory_location_transfer_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

CREATE POLICY "ilti_write_admin" ON inventory_location_transfer_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general','superadmin','gestor_unidad')
    )
  );

DROP FUNCTION IF EXISTS create_transfer_with_warehouse(boolean, uuid, boolean, uuid, jsonb, text, text, text, uuid);

CREATE OR REPLACE FUNCTION create_transfer_with_warehouse(
  p_from_is_warehouse boolean,
  p_from_school_id    uuid,
  p_to_is_warehouse   boolean,
  p_to_school_id      uuid,
  p_items             jsonb,
  p_notes             text DEFAULT NULL,
  p_contact_person    text DEFAULT NULL,
  p_contact_phone     text DEFAULT NULL,
  p_approved_by       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_from_location  uuid;
  v_to_location    uuid;
  v_transfer_id    uuid;
  v_transfer_num   text;
  v_item           jsonb;
  v_product_id     uuid;
  v_qty            integer;
  v_before_school  integer;
  v_after_school   integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no autenticado';
  END IF;

  IF (p_from_is_warehouse AND p_to_is_warehouse) OR (NOT p_from_is_warehouse AND NOT p_to_is_warehouse) THEN
    RAISE EXCEPTION 'VALIDATION: este RPC requiere un traslado mixto (almacén↔sede).';
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: debe incluir al menos un producto';
  END IF;

  v_from_location := CASE
    WHEN p_from_is_warehouse THEN fn_get_primary_warehouse_location_id()
    ELSE fn_get_school_location_id(p_from_school_id)
  END;

  v_to_location := CASE
    WHEN p_to_is_warehouse THEN fn_get_primary_warehouse_location_id()
    ELSE fn_get_school_location_id(p_to_school_id)
  END;

  v_transfer_num := 'TRW-' || EXTRACT(YEAR FROM timezone('America/Lima', now()))::text
                   || '-' || LPAD(nextval('seq_transfer_warehouse_number')::text, 4, '0');

  INSERT INTO inventory_location_transfers (
    transfer_number, from_location_id, to_location_id,
    notes, contact_person, contact_phone, approved_by,
    status, created_by, created_at
  ) VALUES (
    v_transfer_num, v_from_location, v_to_location,
    p_notes,
    CASE WHEN p_from_is_warehouse OR p_to_is_warehouse THEN NULL ELSE p_contact_person END,
    CASE WHEN p_from_is_warehouse OR p_to_is_warehouse THEN NULL ELSE p_contact_phone END,
    p_approved_by,
    'completed', v_caller_id, clock_timestamp()
  )
  RETURNING id INTO v_transfer_id;

  PERFORM set_config('app.kardex_source', 'transfer_rpc', true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'quantity')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad debe ser mayor a 0';
    END IF;

    INSERT INTO inventory_location_transfer_items (transfer_id, product_id, quantity)
    VALUES (v_transfer_id, v_product_id, v_qty);

    IF p_from_is_warehouse THEN
      PERFORM fn_decrement_location_stock(
        v_product_id, v_from_location, v_qty, v_transfer_id,
        format('Guía %s salida de almacén', v_transfer_num), 'transfer_out'
      );

      SELECT COALESCE(current_stock, 0)
      INTO   v_before_school
      FROM   product_stock
      WHERE  product_id = v_product_id
        AND  school_id  = p_to_school_id;

      INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
      VALUES (v_product_id, p_to_school_id, v_qty, true, clock_timestamp())
      ON CONFLICT (product_id, school_id)
      DO UPDATE SET
        current_stock = product_stock.current_stock + v_qty,
        last_updated  = clock_timestamp();

      SELECT current_stock INTO v_after_school
      FROM product_stock
      WHERE product_id = v_product_id
        AND school_id  = p_to_school_id;

      INSERT INTO pos_stock_movements (
        product_id, school_id, movement_type, quantity_delta,
        stock_before, stock_after, reference_id, created_by, created_at, reason
      ) VALUES (
        v_product_id, p_to_school_id, 'transfer_in', v_qty,
        v_before_school, v_after_school, v_transfer_id, v_caller_id, clock_timestamp(),
        format('Guía %s desde Almacén Central', v_transfer_num)
      );

    ELSE
      SELECT COALESCE(current_stock, 0)
      INTO   v_before_school
      FROM   product_stock
      WHERE  product_id = v_product_id
        AND  school_id  = p_from_school_id
      FOR UPDATE;

      IF v_before_school < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stock insuficiente en sede origen. Disponible: %, solicitado: %', v_before_school, v_qty;
      END IF;

      UPDATE product_stock
      SET current_stock = current_stock - v_qty,
          last_updated  = clock_timestamp()
      WHERE product_id = v_product_id
        AND school_id  = p_from_school_id;

      SELECT current_stock INTO v_after_school
      FROM product_stock
      WHERE product_id = v_product_id
        AND school_id  = p_from_school_id;

      INSERT INTO pos_stock_movements (
        product_id, school_id, movement_type, quantity_delta,
        stock_before, stock_after, reference_id, created_by, created_at, reason
      ) VALUES (
        v_product_id, p_from_school_id, 'transfer_out', -v_qty,
        v_before_school, v_after_school, v_transfer_id, v_caller_id, clock_timestamp(),
        format('Guía %s hacia Almacén Central', v_transfer_num)
      );

      PERFORM fn_increment_location_stock(
        v_product_id, v_to_location, v_qty, v_transfer_id,
        format('Guía %s ingreso a almacén', v_transfer_num), 'transfer_in'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'transfer_id', v_transfer_id, 'transfer_number', v_transfer_num);
END;
$$;

GRANT EXECUTE ON FUNCTION create_transfer_with_warehouse(boolean, uuid, boolean, uuid, jsonb, text, text, text, uuid)
  TO authenticated, service_role;

SELECT 'OK: create_transfer_with_warehouse creado (sede↔almacén)' AS resultado;

-- ── 7) Reemplazo seguro de process_ingress_bulk (warehouse real, no school) ──
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
  v_wh_location_id uuid;
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

  IF p_vendor_doc_number IS NOT NULL AND trim(p_vendor_doc_number) <> '' THEN
    IF EXISTS (
      SELECT 1
      FROM inventory_transactions
      WHERE supplier_id        = p_supplier_id
        AND vendor_doc_number  = trim(p_vendor_doc_number)
        AND status            <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_DOC: El documento "%" de este proveedor ya fue registrado y está activo.', trim(p_vendor_doc_number);
    END IF;
  END IF;

  IF p_is_warehouse_only THEN
    v_wh_location_id := fn_get_primary_warehouse_location_id();
  END IF;

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
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto "%" no existe o está inactivo.', COALESCE(v_product_name, v_product_id::text);
    END IF;

    IF NOT p_is_warehouse_only THEN
      IF jsonb_array_length(COALESCE(v_item->'distribution', '[]'::jsonb)) = 0 THEN
        SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
        RAISE EXCEPTION 'VALIDATION: El producto "%" no tiene distribución por sede.', COALESCE(v_product_name, v_product_id::text);
      END IF;

      SELECT COALESCE(SUM((d->>'quantity')::integer), 0)
      INTO   v_sum_dist
      FROM   jsonb_array_elements(v_item->'distribution') d;

      IF v_sum_dist <> v_total_qty THEN
        SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
        RAISE EXCEPTION 'DISTRIBUCION_INVALIDA: La suma de sedes (%) ≠ total (%) para "%".',
          v_sum_dist, v_total_qty, COALESCE(v_product_name, v_product_id::text);
      END IF;
    END IF;

    v_total_amount := v_total_amount + COALESCE((v_item->>'unit_cost')::numeric, 0) * v_total_qty;
  END LOOP;

  SELECT fn_next_ingress_id() INTO v_internal_id;

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
  ) VALUES (
    v_internal_id,
    NULLIF(trim(COALESCE(p_vendor_doc_number, '')), ''),
    p_doc_type,
    p_supplier_id,
    p_is_warehouse_only,
    NULL,
    NULLIF(trim(COALESCE(p_evidence_url, '')), ''),
    v_total_amount,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'completed',
    v_caller_id,
    clock_timestamp()
  ) RETURNING id INTO v_tx_id;

  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_total_qty  := (v_item->>'total_quantity')::integer;
    v_unit_cost  := COALESCE((v_item->>'unit_cost')::numeric, 0);

    INSERT INTO inventory_transaction_items (transaction_id, product_id, total_quantity, unit_cost)
    VALUES (v_tx_id, v_product_id, v_total_qty, v_unit_cost);

    IF v_unit_cost > 0 THEN
      INSERT INTO product_cost_history (product_id, transaction_id, unit_cost, created_by)
      VALUES (v_product_id, v_tx_id, v_unit_cost, v_caller_id);
    END IF;

    IF p_is_warehouse_only THEN
      PERFORM fn_increment_location_stock(
        v_product_id,
        v_wh_location_id,
        v_total_qty,
        v_tx_id,
        format('Ingreso %s — %s %s → Almacén Central', v_internal_id, p_doc_type, COALESCE(p_vendor_doc_number, '')),
        'ingress'
      );
    ELSE
      FOR v_dist IN SELECT value FROM jsonb_array_elements(v_item->'distribution') AS value
      LOOP
        PERFORM increment_product_stock(
          v_product_id,
          (v_dist->>'school_id')::uuid,
          (v_dist->>'quantity')::integer,
          v_tx_id,
          format('Ingreso %s — %s %s → distribución multisede', v_internal_id, p_doc_type, COALESCE(p_vendor_doc_number, '')),
          NULL
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', v_tx_id,
    'internal_transaction_id', v_internal_id,
    'total_amount', v_total_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_ingress_bulk(uuid, text, text, text, text, boolean, uuid, jsonb)
  TO authenticated, service_role;

SELECT 'OK: process_ingress_bulk reemplazado (warehouse como ubicación real)' AS resultado;

SELECT '✅ FASE 3 WAREHOUSE BRIDGE: completado' AS resultado;
