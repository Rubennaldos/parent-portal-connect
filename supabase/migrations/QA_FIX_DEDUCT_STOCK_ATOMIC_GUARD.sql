-- QA FIX — Vector 1: Concurrencia en deduct_product_stock
-- PROBLEMA: La versión anterior en LANGUAGE sql permitía que dos transacciones
-- concurrentes redujeran el stock al mismo tiempo llevándolo a negativo.
-- SOLUCIÓN: plpgsql + SELECT FOR UPDATE (bloqueo de fila) + guard de suficiencia.
-- NOTA: Se hace DROP primero porque cambia el tipo de retorno (void → jsonb).

DROP FUNCTION IF EXISTS deduct_product_stock(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION deduct_product_stock(
  p_product_id  uuid,
  p_school_id   uuid,
  p_quantity    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock integer;
BEGIN
  -- Bloquea la fila EXCLUSIVAMENTE antes de leer el stock.
  -- Si otra transacción está modificando la misma fila, esta espera.
  SELECT current_stock
    INTO v_current_stock
    FROM product_stock
   WHERE product_id = p_product_id
     AND school_id  = p_school_id
     AND is_enabled = true
   FOR UPDATE;

  -- Si no existe fila de stock para este producto × sede, ignorar silenciosamente.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_stock_row');
  END IF;

  -- Guard: verificar stock suficiente DENTRO del bloqueo.
  IF v_current_stock < p_quantity THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'reason',  'INSUFFICIENT_STOCK',
      'stock',   v_current_stock,
      'needed',  p_quantity
    );
  END IF;

  -- Descuento atómico garantizado.
  UPDATE product_stock
     SET current_stock = current_stock - p_quantity,
         last_updated  = now()
   WHERE product_id = p_product_id
     AND school_id  = p_school_id;

  RETURN jsonb_build_object('ok', true, 'stock_after', v_current_stock - p_quantity);
END;
$$;

-- Aseguramos permisos
GRANT EXECUTE ON FUNCTION deduct_product_stock(uuid, uuid, integer) TO authenticated, service_role;
