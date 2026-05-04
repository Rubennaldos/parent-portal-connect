-- =============================================================================
-- RPC atómico: alcance por sede (products.school_ids) + precios (product_school_prices)
--
-- - admin_general / supervisor_red: actualiza school_ids, borra precios del
--   producto y reinserta el lote enviado (misma semántica que PriceMatrix admin).
-- - gestor_unidad: NO modifica school_ids; solo borra/reinserta la fila de SU sede.
--
-- Retorno jsonb: { ok, mode, product_id, rows_inserted }
-- Errores: prefijo SAVE_SCOPE_PRICES_* (y triggers PRICE_* existentes en INSERT)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_product_scope_and_prices(
  p_product_id uuid,
  p_school_ids uuid[],
  p_prices jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text;
  v_gestor_sch uuid;
  v_elem       jsonb;
  v_sid        uuid;
  v_ps         numeric;
  v_pc         numeric;
  v_avail      boolean;
  v_inserted   int := 0;
  v_scope      uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'SAVE_SCOPE_PRICES_UNAUTH: sesión no válida.';
  END IF;

  SELECT p.role, p.school_id
    INTO v_role, v_gestor_sch
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SAVE_SCOPE_PRICES_NO_PROFILE';
  END IF;

  SELECT school_ids INTO v_scope
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SAVE_SCOPE_PRICES_PRODUCT_NOT_FOUND';
  END IF;

  IF v_role IN ('admin_general', 'supervisor_red') THEN
    UPDATE public.products
    SET school_ids = p_school_ids
    WHERE id = p_product_id;

    DELETE FROM public.product_school_prices
    WHERE product_id = p_product_id;

    FOR v_elem IN
      SELECT jsonb_array_elements(COALESCE(p_prices, '[]'::jsonb))
    LOOP
      v_sid := (v_elem->>'school_id')::uuid;
      v_ps := (v_elem->>'price_sale')::numeric;

      IF (v_elem ? 'price_cost')
         AND v_elem->>'price_cost' IS NOT NULL
         AND btrim(v_elem->>'price_cost') <> '' THEN
        v_pc := (v_elem->>'price_cost')::numeric;
      ELSE
        v_pc := NULL;
      END IF;

      IF (v_elem ? 'is_available') AND v_elem->>'is_available' IS NOT NULL THEN
        v_avail := (v_elem->>'is_available')::boolean;
      ELSE
        v_avail := true;
      END IF;

      INSERT INTO public.product_school_prices (
        product_id, school_id, price_sale, price_cost, is_available
      )
      VALUES (
        p_product_id, v_sid, v_ps, v_pc, v_avail
      );
      v_inserted := v_inserted + 1;
    END LOOP;

    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'admin',
      'product_id', p_product_id,
      'rows_inserted', v_inserted
    );

  ELSIF v_role = 'gestor_unidad' THEN
    IF v_gestor_sch IS NULL THEN
      RAISE EXCEPTION 'SAVE_SCOPE_PRICES_GESTOR_NO_SCHOOL';
    END IF;

    IF v_scope IS NOT NULL AND COALESCE(cardinality(v_scope), 0) > 0 THEN
      IF NOT (v_gestor_sch = ANY (v_scope)) THEN
        RAISE EXCEPTION 'SAVE_SCOPE_PRICES_GESTOR_FORBIDDEN: el producto no está disponible en tu sede.';
      END IF;
    END IF;

    DELETE FROM public.product_school_prices
    WHERE product_id = p_product_id
      AND school_id = v_gestor_sch;

    FOR v_elem IN
      SELECT jsonb_array_elements(COALESCE(p_prices, '[]'::jsonb))
    LOOP
      v_sid := (v_elem->>'school_id')::uuid;
      IF v_sid IS DISTINCT FROM v_gestor_sch THEN
        RAISE EXCEPTION 'SAVE_SCOPE_PRICES_GESTOR_ONLY_OWN_SCHOOL';
      END IF;
      v_ps := (v_elem->>'price_sale')::numeric;

      IF (v_elem ? 'price_cost')
         AND v_elem->>'price_cost' IS NOT NULL
         AND btrim(v_elem->>'price_cost') <> '' THEN
        v_pc := (v_elem->>'price_cost')::numeric;
      ELSE
        v_pc := NULL;
      END IF;

      IF (v_elem ? 'is_available') AND v_elem->>'is_available' IS NOT NULL THEN
        v_avail := (v_elem->>'is_available')::boolean;
      ELSE
        v_avail := true;
      END IF;

      INSERT INTO public.product_school_prices (
        product_id, school_id, price_sale, price_cost, is_available
      )
      VALUES (
        p_product_id, v_sid, v_ps, v_pc, v_avail
      );
      v_inserted := v_inserted + 1;
    END LOOP;

    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'gestor',
      'product_id', p_product_id,
      'rows_inserted', v_inserted
    );
  ELSE
    RAISE EXCEPTION 'SAVE_SCOPE_PRICES_FORBIDDEN: rol no autorizado.';
  END IF;
END;
$f$;

COMMENT ON FUNCTION public.save_product_scope_and_prices(uuid, uuid[], jsonb) IS
  'Transacción atómica: admin/supervisor actualiza school_ids y reemplaza precios por sede; gestor solo su sede.';

REVOKE ALL ON FUNCTION public.save_product_scope_and_prices(uuid, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_product_scope_and_prices(uuid, uuid[], jsonb) TO authenticated;
