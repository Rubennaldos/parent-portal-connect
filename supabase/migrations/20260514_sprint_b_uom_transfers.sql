-- ============================================================
-- SPRINT B — Logística: Repartición, UoM y Transferencias Internas
-- ============================================================
-- Cambios:
--   1. Campos UoM en purchase_entry_items (uom_id, uom_quantity)
--   2. Tabla internal_transfers (cabecera de traslados entre sedes)
--   3. Tabla internal_transfer_items (detalle de traslados)
--   4. RPC create_internal_transfer (atómica, doble asiento de stock)
-- ============================================================

-- ── 1. UoM en purchase_entry_items ──────────────────────────────────────────

ALTER TABLE purchase_entry_items
  ADD COLUMN IF NOT EXISTS uom_id       uuid    REFERENCES product_packaging(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uom_quantity numeric;

COMMENT ON COLUMN purchase_entry_items.uom_id IS
  'Empaque con que se recibió (Caja, Tira, Display). Si NULL se recibió en unidades directamente.';
COMMENT ON COLUMN purchase_entry_items.uom_quantity IS
  'Cantidad en la unidad de empaque (ej: 2 si entraron 2 Cajas). La columna quantity sigue siendo la cantidad en unidad base.';

SELECT 'OK: UoM añadido a purchase_entry_items' AS resultado;

-- ── 2. Tabla internal_transfers ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS internal_transfers (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  from_school_id   uuid        NOT NULL REFERENCES schools(id)  ON DELETE RESTRICT,
  to_school_id     uuid        NOT NULL REFERENCES schools(id)  ON DELETE RESTRICT,
  status           text        NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'pending', 'cancelled')),
  notes            text,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_transfer_different_schools
    CHECK (from_school_id <> to_school_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_from  ON internal_transfers (from_school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to    ON internal_transfers (to_school_id,   created_at DESC);

ALTER TABLE internal_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transfers_read_admin"  ON internal_transfers;
DROP POLICY IF EXISTS "transfers_write_admin" ON internal_transfers;

CREATE POLICY "transfers_read_admin" ON internal_transfers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin', 'gestor_unidad', 'cajero', 'operador_caja')
    )
  );

CREATE POLICY "transfers_write_admin" ON internal_transfers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin', 'gestor_unidad')
    )
  );

SELECT 'OK: internal_transfers creada' AS resultado;

-- ── 3. Tabla internal_transfer_items ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS internal_transfer_items (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id   uuid    NOT NULL REFERENCES internal_transfers(id) ON DELETE CASCADE,
  product_id    uuid    NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity      integer NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON internal_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_product  ON internal_transfer_items (product_id);

ALTER TABLE internal_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transfer_items_read_auth"   ON internal_transfer_items;
DROP POLICY IF EXISTS "transfer_items_write_admin" ON internal_transfer_items;

CREATE POLICY "transfer_items_read_auth" ON internal_transfer_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "transfer_items_write_admin" ON internal_transfer_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general', 'superadmin', 'gestor_unidad')
    )
  );

SELECT 'OK: internal_transfer_items creada' AS resultado;

-- ── 4. RPC create_internal_transfer ─────────────────────────────────────────
-- Doble asiento atómico: descuenta en origen, suma en destino,
-- registra en Kardex con tipos transfer_out / transfer_in.

CREATE OR REPLACE FUNCTION create_internal_transfer(
  p_from_school_id uuid,
  p_to_school_id   uuid,
  p_items          jsonb,   -- [{ product_id, quantity }]
  p_notes          text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid;
  v_transfer_id  uuid;
  v_item         jsonb;
  v_product_id   uuid;
  v_quantity     integer;
  v_stock_before integer;
  v_stock_after  integer;
  v_dest_before  integer;
  v_dest_after   integer;
  v_product_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no autenticado';
  END IF;

  IF p_from_school_id = p_to_school_id THEN
    RAISE EXCEPTION 'INVALID_TRANSFER: origen y destino no pueden ser la misma sede';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'INVALID_TRANSFER: debe incluir al menos un producto';
  END IF;

  -- Bloquear filas de origen en orden determinista (evita deadlocks)
  PERFORM ps.product_id
  FROM product_stock ps
  WHERE ps.school_id = p_from_school_id
    AND ps.product_id = ANY (
      ARRAY(
        SELECT (elem->>'product_id')::uuid
        FROM jsonb_array_elements(p_items) elem
      )
    )
  ORDER BY ps.product_id
  FOR UPDATE OF ps;

  -- Validar stock disponible en origen
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad debe ser mayor a 0';
    END IF;

    SELECT ps.current_stock, p.name
    INTO   v_stock_before, v_product_name
    FROM   product_stock ps
    JOIN   products p ON p.id = ps.product_id
    WHERE  ps.product_id = v_product_id
      AND  ps.school_id  = p_from_school_id;

    IF NOT FOUND THEN
      SELECT name INTO v_product_name FROM products WHERE id = v_product_id;
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: "%" no tiene stock registrado en la sede de origen', v_product_name;
    END IF;

    IF v_stock_before < v_quantity THEN
      RAISE EXCEPTION
        'INSUFFICIENT_STOCK: Stock insuficiente para "%". Disponible: %, Solicitado: %',
        v_product_name, v_stock_before, v_quantity;
    END IF;
  END LOOP;

  -- Crear cabecera del traslado
  INSERT INTO internal_transfers (from_school_id, to_school_id, notes, created_by)
  VALUES (p_from_school_id, p_to_school_id, p_notes, v_caller_id)
  RETURNING id INTO v_transfer_id;

  -- Suprimir trigger genérico en product_stock
  PERFORM set_config('app.kardex_source', 'transfer_rpc', true);

  -- Procesar cada ítem
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    SELECT ps.current_stock, p.name
    INTO   v_stock_before, v_product_name
    FROM   product_stock ps
    JOIN   products p ON p.id = ps.product_id
    WHERE  ps.product_id = v_product_id AND ps.school_id = p_from_school_id;

    SELECT COALESCE(current_stock, 0)
    INTO   v_dest_before
    FROM   product_stock
    WHERE  product_id = v_product_id AND school_id = p_to_school_id;

    v_stock_after := v_stock_before - v_quantity;
    v_dest_after  := COALESCE(v_dest_before, 0) + v_quantity;

    -- Descontar en origen
    UPDATE product_stock
    SET    current_stock = current_stock - v_quantity,
           last_updated  = clock_timestamp()
    WHERE  product_id = v_product_id
      AND  school_id  = p_from_school_id;

    -- Sumar en destino (upsert)
    INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
    VALUES (v_product_id, p_to_school_id, v_quantity, true, clock_timestamp())
    ON CONFLICT (product_id, school_id)
    DO UPDATE SET
      current_stock = product_stock.current_stock + v_quantity,
      last_updated  = clock_timestamp();

    -- Ítem del traslado
    INSERT INTO internal_transfer_items (transfer_id, product_id, quantity)
    VALUES (v_transfer_id, v_product_id, v_quantity);

    -- Kardex: salida de origen
    INSERT INTO pos_stock_movements (
      product_id, school_id,
      movement_type, quantity_delta,
      stock_before,  stock_after,
      reference_id,  created_by,
      created_at,    reason
    ) VALUES (
      v_product_id, p_from_school_id,
      'transfer_out', -v_quantity,
      v_stock_before, v_stock_after,
      v_transfer_id, v_caller_id,
      clock_timestamp(),
      'Traslado a sede destino'
    );

    -- Kardex: entrada a destino
    INSERT INTO pos_stock_movements (
      product_id, school_id,
      movement_type, quantity_delta,
      stock_before,  stock_after,
      reference_id,  created_by,
      created_at,    reason
    ) VALUES (
      v_product_id, p_to_school_id,
      'transfer_in', v_quantity,
      COALESCE(v_dest_before, 0), v_dest_after,
      v_transfer_id, v_caller_id,
      clock_timestamp(),
      'Traslado desde sede origen'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'transfer_id', v_transfer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_internal_transfer(uuid, uuid, jsonb, text)
  TO authenticated, service_role;

SELECT 'OK: create_internal_transfer creada con doble asiento atómico' AS resultado;
