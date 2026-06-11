-- ============================================================
-- SECURITY SANITY CHECK — Logística
-- ============================================================
-- Objetivo:
-- 1) RLS estricto: acceso a logística solo admin_general
-- 2) RPC create_internal_transfer valida sedes existentes
-- 3) conversion_factor siempre > 0 en product_packaging
-- ============================================================

-- ── 1) RLS estricto para suppliers (solo admin_general) ─────────────────────
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_read_all"         ON suppliers;
DROP POLICY IF EXISTS "suppliers_write_admin"      ON suppliers;
DROP POLICY IF EXISTS "suppliers_read_admin_only"  ON suppliers;
DROP POLICY IF EXISTS "suppliers_write_admin_only" ON suppliers;

CREATE POLICY "suppliers_read_admin_only" ON suppliers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  );

CREATE POLICY "suppliers_write_admin_only" ON suppliers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  );

-- ── 1b) RLS estricto para internal_transfers (solo admin_general) ───────────
ALTER TABLE internal_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transfers_read_admin"       ON internal_transfers;
DROP POLICY IF EXISTS "transfers_write_admin"      ON internal_transfers;
DROP POLICY IF EXISTS "transfers_read_admin_only"  ON internal_transfers;
DROP POLICY IF EXISTS "transfers_write_admin_only" ON internal_transfers;

CREATE POLICY "transfers_read_admin_only" ON internal_transfers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  );

CREATE POLICY "transfers_write_admin_only" ON internal_transfers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  );

-- ── 1c) RLS estricto para internal_transfer_items (solo admin_general) ──────
ALTER TABLE internal_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transfer_items_read_auth"       ON internal_transfer_items;
DROP POLICY IF EXISTS "transfer_items_write_admin"     ON internal_transfer_items;
DROP POLICY IF EXISTS "transfer_items_read_admin_only" ON internal_transfer_items;
DROP POLICY IF EXISTS "transfer_items_write_admin_only" ON internal_transfer_items;

CREATE POLICY "transfer_items_read_admin_only" ON internal_transfer_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  );

CREATE POLICY "transfer_items_write_admin_only" ON internal_transfer_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  );

-- ── 2) RPC create_internal_transfer: validar sedes existentes ───────────────
CREATE OR REPLACE FUNCTION create_internal_transfer(
  p_from_school_id uuid,
  p_to_school_id   uuid,
  p_items          jsonb,
  p_notes          text DEFAULT NULL
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

  -- UUID viene validado por la firma de la función (tipo uuid).
  -- Aquí validamos existencia real de sedes para evitar huérfanos.
  IF NOT EXISTS (SELECT 1 FROM schools s WHERE s.id = p_from_school_id) THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: sede origen no existe (%).', p_from_school_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schools s WHERE s.id = p_to_school_id) THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: sede destino no existe (%).', p_to_school_id;
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

    UPDATE product_stock
    SET    current_stock = current_stock - v_quantity,
           last_updated  = clock_timestamp()
    WHERE  product_id = v_product_id
      AND  school_id  = p_from_school_id;

    INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
    VALUES (v_product_id, p_to_school_id, v_quantity, true, clock_timestamp())
    ON CONFLICT (product_id, school_id)
    DO UPDATE SET
      current_stock = product_stock.current_stock + v_quantity,
      last_updated  = clock_timestamp();

    INSERT INTO internal_transfer_items (transfer_id, product_id, quantity)
    VALUES (v_transfer_id, v_product_id, v_quantity);

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

-- ── 3) conversion_factor > 0 (consistencia de tipos) ────────────────────────
-- Curar datos previos inválidos antes del CHECK para no romper migración.
UPDATE product_packaging
SET conversion_factor = 1
WHERE conversion_factor IS NULL OR conversion_factor <= 0;

ALTER TABLE product_packaging
  DROP CONSTRAINT IF EXISTS chk_product_packaging_conversion_factor_positive;

ALTER TABLE product_packaging
  ADD CONSTRAINT chk_product_packaging_conversion_factor_positive
  CHECK (conversion_factor > 0);

SELECT 'SECURITY SANITY CHECK aplicado: RLS admin_general + validación sedes + conversion_factor > 0' AS resultado;
