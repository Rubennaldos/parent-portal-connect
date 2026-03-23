-- =============================================================================
-- RPC: absorb_product
-- El producto MASTER (verificado/verde) absorbe el historial de un producto MENOR.
-- A diferencia de merge_products, el producto menor PERMANECE ACTIVO.
-- Solo se redirige el historial (ventas, compras, stock) al master.
-- =============================================================================

CREATE OR REPLACE FUNCTION absorb_product(
  p_master_id uuid,   -- El producto verde (oficial) que absorbe
  p_minor_id  uuid    -- El producto menor que será absorbido
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validaciones
  IF p_master_id = p_minor_id THEN
    RAISE EXCEPTION 'El producto master y el menor no pueden ser el mismo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_master_id AND active = true) THEN
    RAISE EXCEPTION 'El producto master no existe o está inactivo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_minor_id AND active = true) THEN
    RAISE EXCEPTION 'El producto menor no existe o está inactivo.';
  END IF;

  -- ── 1. Redirigir historial de ventas ──────────────────────────────────────
  UPDATE transaction_items
     SET product_id = p_master_id
   WHERE product_id = p_minor_id;

  -- ── 2. Redirigir historial de compras ─────────────────────────────────────
  UPDATE purchase_entry_items
     SET product_id = p_master_id
   WHERE product_id = p_minor_id;

  -- ── 3. Consolidar stock del menor en el master ────────────────────────────
  -- Por cada sede donde el menor tenga stock, sumarlo al master
  INSERT INTO product_stock (product_id, school_id, current_stock)
  SELECT
    p_master_id,
    school_id,
    SUM(current_stock)
  FROM product_stock
  WHERE product_id = p_minor_id
  GROUP BY school_id
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + EXCLUDED.current_stock,
    last_updated  = now();

  -- Limpiar stock del menor (queda en 0 en todas las sedes)
  UPDATE product_stock
     SET current_stock = 0,
         last_updated  = now()
   WHERE product_id = p_minor_id;

  -- ── 4. Heredar school_ids del menor en el master ──────────────────────────
  -- El master pasa a estar disponible en todas las sedes del menor también
  UPDATE products
     SET school_ids = (
       SELECT array_agg(DISTINCT sid)
       FROM (
         SELECT unnest(school_ids) AS sid FROM products WHERE id = p_master_id
         UNION
         SELECT unnest(school_ids) AS sid FROM products WHERE id = p_minor_id
       ) combined
     )
   WHERE id = p_master_id;

  -- ── 5. El producto menor PERMANECE ACTIVO (no se desactiva) ───────────────
  -- Solo marcamos que fue absorbido (campo de referencia opcional)
  -- El menor sigue siendo vendible, pero su historial apunta al master.

END;
$$;

REVOKE ALL ON FUNCTION absorb_product(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION absorb_product(uuid, uuid) TO authenticated;
