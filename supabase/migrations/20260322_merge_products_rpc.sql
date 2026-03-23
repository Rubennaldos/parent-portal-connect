-- =============================================================================
-- FUNCIÓN RPC: merge_products
-- Fusiona N productos viejos en uno nuevo de forma transaccional.
-- Actualiza todas las tablas dependientes para no perder historial.
-- =============================================================================

CREATE OR REPLACE FUNCTION merge_products(
  p_old_product_ids  uuid[],          -- IDs de los productos a fusionar
  p_new_product_data jsonb,           -- Datos del nuevo producto {name, code, category, price_sale, price_cost, ...}
  p_school_prices    jsonb DEFAULT '[]'::jsonb  -- [{school_id, price_sale}]
)
RETURNS uuid   -- Devuelve el ID del nuevo producto creado
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id      uuid;
  v_school_row  jsonb;
BEGIN
  -- ── Validaciones básicas ────────────────────────────────────────────────────
  IF array_length(p_old_product_ids, 1) IS NULL OR array_length(p_old_product_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Debes seleccionar al menos un producto para fusionar.';
  END IF;
  IF p_new_product_data->>'name' IS NULL OR trim(p_new_product_data->>'name') = '' THEN
    RAISE EXCEPTION 'El nombre del nuevo producto es obligatorio.';
  END IF;

  -- ── 1. Insertar el nuevo producto ─────────────────────────────────────────
  INSERT INTO products (
    name,
    code,
    category,
    price,
    price_sale,
    price_cost,
    has_igv,
    has_stock,
    active,
    school_ids,
    stock_control_enabled,
    description,
    is_verified   -- ✅ SELLO VERDE: el producto fusionado siempre es verificado
  )
  SELECT
    p_new_product_data->>'name',
    COALESCE(p_new_product_data->>'code', ''),
    COALESCE(p_new_product_data->>'category', 'otros'),
    COALESCE((p_new_product_data->>'price_sale')::numeric, 0),
    COALESCE((p_new_product_data->>'price_sale')::numeric, 0),
    COALESCE((p_new_product_data->>'price_cost')::numeric, 0),
    COALESCE((p_new_product_data->>'has_igv')::boolean, true),
    false,
    true,
    -- Heredar la unión de todas las school_ids de los productos viejos
    (
      SELECT array_agg(DISTINCT sid)
      FROM products p, unnest(p.school_ids) AS sid
      WHERE p.id = ANY(p_old_product_ids)
    ),
    false,
    p_new_product_data->>'description',
    true   -- is_verified = true → Sello Verde
  RETURNING id INTO v_new_id;

  -- ── 2. Insertar precios por sede ─────────────────────────────────────────
  IF jsonb_array_length(p_school_prices) > 0 THEN
    FOR v_school_row IN SELECT * FROM jsonb_array_elements(p_school_prices)
    LOOP
      INSERT INTO product_school_prices (product_id, school_id, price_sale)
      VALUES (
        v_new_id,
        (v_school_row->>'school_id')::uuid,
        (v_school_row->>'price_sale')::numeric
      )
      ON CONFLICT (product_id, school_id)
      DO UPDATE SET price_sale = EXCLUDED.price_sale;
    END LOOP;
  END IF;

  -- ── 3. Redirigir historial: transaction_items ────────────────────────────
  UPDATE transaction_items
     SET product_id = v_new_id
   WHERE product_id = ANY(p_old_product_ids);

  -- ── 4. Redirigir historial: purchase_entry_items ─────────────────────────
  UPDATE purchase_entry_items
     SET product_id = v_new_id
   WHERE product_id = ANY(p_old_product_ids);

  -- ── 5. Consolidar stock: sumar todo el stock de los productos viejos ──────
  -- Primero creamos/actualizamos el stock del nuevo producto por sede
  INSERT INTO product_stock (product_id, school_id, current_stock)
  SELECT
    v_new_id,
    school_id,
    SUM(current_stock)
  FROM product_stock
  WHERE product_id = ANY(p_old_product_ids)
  GROUP BY school_id
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + EXCLUDED.current_stock,
    last_updated  = now();

  -- Borrar los registros de stock de los viejos
  DELETE FROM product_stock
  WHERE product_id = ANY(p_old_product_ids);

  -- ── 6. Desactivar los productos viejos (no borrar para mantener integridad) ─
  UPDATE products
     SET active = false
   WHERE id = ANY(p_old_product_ids);

  RETURN v_new_id;
END;
$$;

-- Permiso: solo admins pueden ejecutar el merge
REVOKE ALL ON FUNCTION merge_products(uuid[], jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_products(uuid[], jsonb, jsonb)
  TO authenticated;
