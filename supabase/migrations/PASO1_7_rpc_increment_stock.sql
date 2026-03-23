-- PASO 1.7 — RPC: sumar stock al registrar entrada de compra
CREATE OR REPLACE FUNCTION increment_product_stock(
  p_product_id  uuid,
  p_school_id   uuid,
  p_quantity    integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO product_stock (product_id, school_id, current_stock)
  VALUES (p_product_id, p_school_id, p_quantity)
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + p_quantity,
    last_updated  = now();
$$;
