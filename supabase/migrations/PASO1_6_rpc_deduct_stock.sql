-- PASO 1.6 — RPC: descontar stock al vender (necesita product_stock de 1.2)
CREATE OR REPLACE FUNCTION deduct_product_stock(
  p_product_id  uuid,
  p_school_id   uuid,
  p_quantity    integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE product_stock
     SET current_stock = current_stock - p_quantity,
         last_updated  = now()
   WHERE product_id = p_product_id
     AND school_id  = p_school_id;
$$;
