-- ============================================================
-- INVENTORY LOCATION STOCK — Atomicidad y Null Safety
-- ============================================================
-- Objetivo:
-- 1) Blindar stock_before/stock_after en inventory_location_movements.
-- 2) Evitar NULL cuando no existe fila previa en product_stock_locations.
-- 3) Mantener una sola lógica oficial para ingreso/salida por ubicación.
--
-- Alcance:
-- - Reemplaza fn_increment_location_stock y fn_decrement_location_stock.
-- - No modifica tablas ni contratos de UI.
-- - No toca pasarela de pagos ni saldo financiero.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_increment_location_stock(
  p_product_id    uuid,
  p_location_id   uuid,
  p_quantity      integer,
  p_reference_id  uuid DEFAULT NULL,
  p_reason        text DEFAULT NULL,
  p_movement_type text DEFAULT 'ingress'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after  integer;
  v_before integer;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad debe ser mayor a 0';
  END IF;

  -- Upsert atómico: crea fila si no existe o incrementa si ya existe.
  -- RETURNING da el stock final real de BD sin cálculos en cliente.
  INSERT INTO product_stock_locations (product_id, location_id, current_stock, last_updated)
  VALUES (p_product_id, p_location_id, p_quantity, clock_timestamp())
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET
    current_stock = product_stock_locations.current_stock + EXCLUDED.current_stock,
    last_updated  = clock_timestamp()
  RETURNING current_stock
  INTO v_after;

  -- v_after siempre existe aquí; stock_before queda determinado sin NULL.
  v_before := v_after - p_quantity;

  INSERT INTO inventory_location_movements (
    product_id,
    location_id,
    movement_type,
    quantity_delta,
    stock_before,
    stock_after,
    reference_id,
    reason,
    created_by,
    created_at
  ) VALUES (
    p_product_id,
    p_location_id,
    p_movement_type,
    p_quantity,
    v_before,
    v_after,
    p_reference_id,
    p_reason,
    auth.uid(),
    clock_timestamp()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_increment_location_stock(uuid, uuid, integer, uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_decrement_location_stock(
  p_product_id    uuid,
  p_location_id   uuid,
  p_quantity      integer,
  p_reference_id  uuid DEFAULT NULL,
  p_reason        text DEFAULT NULL,
  p_movement_type text DEFAULT 'transfer_out'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before    integer;
  v_after     integer;
  v_available integer;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad debe ser mayor a 0';
  END IF;

  -- Update condicional atómico:
  -- solo descuenta si existe fila y alcanza el stock.
  UPDATE product_stock_locations
  SET current_stock = current_stock - p_quantity,
      last_updated  = clock_timestamp()
  WHERE product_id = p_product_id
    AND location_id = p_location_id
    AND current_stock >= p_quantity
  RETURNING current_stock + p_quantity, current_stock
  INTO v_before, v_after;

  IF NOT FOUND THEN
    SELECT COALESCE(
      (SELECT psl.current_stock
       FROM product_stock_locations psl
       WHERE psl.product_id = p_product_id
         AND psl.location_id = p_location_id
       LIMIT 1),
      0
    ) INTO v_available;

    RAISE EXCEPTION
      'INSUFFICIENT_STOCK: stock insuficiente en almacén. Disponible: %, solicitado: %',
      v_available, p_quantity;
  END IF;

  INSERT INTO inventory_location_movements (
    product_id,
    location_id,
    movement_type,
    quantity_delta,
    stock_before,
    stock_after,
    reference_id,
    reason,
    created_by,
    created_at
  ) VALUES (
    p_product_id,
    p_location_id,
    p_movement_type,
    -p_quantity,
    v_before,
    v_after,
    p_reference_id,
    p_reason,
    auth.uid(),
    clock_timestamp()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_decrement_location_stock(uuid, uuid, integer, uuid, text, text)
  TO authenticated, service_role;

SELECT 'OK: fn_increment_location_stock/fn_decrement_location_stock blindadas (atomicidad + null safety)' AS resultado;
