-- ============================================================
-- FIX: merge_products hereda stock_control_enabled del origen
-- ============================================================
-- Problema: la función original forzaba stock_control_enabled = false
-- en el producto maestro resultante de una fusión, sin importar si
-- los productos de origen tenían el control activo.
--
-- Solución quirúrgica: reemplazar solo la función merge_products.
-- No se tocan RLS, roles ni permisos de ninguna tabla.
--
-- Regla de herencia: el producto maestro activa stock_control_enabled
-- si AL MENOS UNO de los productos fusionados lo tenía activo.
-- Esto preserva el inventario ya rastreado.
-- ============================================================


CREATE OR REPLACE FUNCTION merge_products(
  p_old_product_ids  uuid[],
  p_new_product_data jsonb,
  p_school_prices    jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id              uuid;
  v_school_row          jsonb;
  v_inherited_sce       boolean;
BEGIN
  -- ── Validaciones ───────────────────────────────────────────────────────────
  IF array_length(p_old_product_ids, 1) IS NULL OR array_length(p_old_product_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Debes seleccionar al menos un producto para fusionar.';
  END IF;
  IF p_new_product_data->>'name' IS NULL OR trim(p_new_product_data->>'name') = '' THEN
    RAISE EXCEPTION 'El nombre del nuevo producto es obligatorio.';
  END IF;

  -- Herencia: si al menos un origen tenía control de stock activo, el maestro también.
  SELECT bool_or(stock_control_enabled)
    INTO v_inherited_sce
  FROM public.products
  WHERE id = ANY(p_old_product_ids);

  v_inherited_sce := COALESCE(v_inherited_sce, false);

  -- ── 1. Insertar el nuevo producto maestro ──────────────────────────────────
  INSERT INTO public.products (
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
    is_verified
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
    (
      SELECT array_agg(DISTINCT sid)
      FROM public.products p, unnest(p.school_ids) AS sid
      WHERE p.id = ANY(p_old_product_ids)
    ),
    v_inherited_sce,
    p_new_product_data->>'description',
    true
  RETURNING id INTO v_new_id;

  -- ── 2. Precios por sede ────────────────────────────────────────────────────
  IF jsonb_array_length(p_school_prices) > 0 THEN
    FOR v_school_row IN SELECT * FROM jsonb_array_elements(p_school_prices)
    LOOP
      INSERT INTO public.product_school_prices (product_id, school_id, price_sale)
      VALUES (
        v_new_id,
        (v_school_row->>'school_id')::uuid,
        (v_school_row->>'price_sale')::numeric
      )
      ON CONFLICT (product_id, school_id)
      DO UPDATE SET price_sale = EXCLUDED.price_sale;
    END LOOP;
  END IF;

  -- ── 3. Redirigir historial de ventas ───────────────────────────────────────
  UPDATE public.transaction_items
     SET product_id = v_new_id
   WHERE product_id = ANY(p_old_product_ids);

  -- ── 4. Redirigir historial de compras ──────────────────────────────────────
  UPDATE public.purchase_entry_items
     SET product_id = v_new_id
   WHERE product_id = ANY(p_old_product_ids);

  -- ── 5. Consolidar stock por sede ───────────────────────────────────────────
  INSERT INTO public.product_stock (product_id, school_id, current_stock)
  SELECT
    v_new_id,
    school_id,
    SUM(current_stock)
  FROM public.product_stock
  WHERE product_id = ANY(p_old_product_ids)
  GROUP BY school_id
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + EXCLUDED.current_stock,
    last_updated  = now();

  DELETE FROM public.product_stock
  WHERE product_id = ANY(p_old_product_ids);

  -- ── 6. Desactivar productos fusionados ─────────────────────────────────────
  UPDATE public.products
     SET active = false
   WHERE id = ANY(p_old_product_ids);

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION merge_products(uuid[], jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_products(uuid[], jsonb, jsonb) TO authenticated;

SELECT 'OK: merge_products actualizado — hereda stock_control_enabled del origen' AS resultado;


-- ============================================================
-- REPARACIÓN ONE-SHOT: productos afectados en producción
-- ============================================================
-- Activa el control de stock en productos cuyo nombre contiene
-- "MANDARINA" y que quedaron con el flag en false.
-- Seguro: solo toca la columna stock_control_enabled, no mueve
-- saldos, precios ni datos financieros.
-- ============================================================

UPDATE public.products
   SET stock_control_enabled = true
 WHERE name ILIKE '%MANDARINA%'
   AND stock_control_enabled = false;

SELECT
  'Reparados: ' || COUNT(*)::text || ' producto(s) MANDARINA con stock_control_enabled activado' AS resultado
FROM public.products
WHERE name ILIKE '%MANDARINA%'
  AND stock_control_enabled = true;
