-- ============================================================
-- HOTFIX DEFINITIVO — increment_product_stock limpio y único
-- ============================================================
-- Problema 1: firma ambigua (dos versiones compitiendo).
-- Problema 2: v_stock_before queda NULL cuando el producto no existe
--             aún en product_stock, y pos_stock_movements rechaza NULL.
--
-- Solución:
--   1) Eliminar TODAS las variantes existentes.
--   2) Crear UNA sola versión canónica de 6 parámetros con:
--      - stock_before calculado via subquery escalar (NULL-safe).
--      - UoM conversion en BD (igual que qa_audit_fixes).
--      - Retorna jsonb para confirmación en frontend.
-- ============================================================

-- Limpiar TODAS las variantes sin importar firma ni tipo de retorno
DROP FUNCTION IF EXISTS public.increment_product_stock(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.increment_product_stock(uuid, uuid, integer, uuid, text);
DROP FUNCTION IF EXISTS public.increment_product_stock(uuid, uuid, integer, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.increment_product_stock(
  p_product_id uuid,
  p_school_id  uuid,
  p_quantity   integer,
  p_entry_id   uuid DEFAULT NULL,
  p_reason     text DEFAULT NULL,
  p_uom_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_before integer;
  v_stock_after  integer;
  v_factor       integer := 1;
  v_uom_name     text;
  v_base_qty     integer;
  v_audit_reason text;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INCREMENT_STOCK: la cantidad debe ser mayor a 0';
  END IF;

  -- ── Resolución UoM: conversión ocurre en BD, nunca en el cliente ─────
  IF p_uom_id IS NOT NULL THEN
    SELECT conversion_factor, uom_name
    INTO   v_factor, v_uom_name
    FROM   product_packaging
    WHERE  id         = p_uom_id
      AND  product_id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'UOM_NOT_FOUND: El empaque no existe o no pertenece a este producto';
    END IF;

    IF v_factor IS NULL OR v_factor <= 0 THEN
      RAISE EXCEPTION 'UOM_INVALID: El factor de conversión debe ser mayor a 0';
    END IF;
  END IF;

  v_base_qty := p_quantity * COALESCE(v_factor, 1);

  -- ── Stock antes — NULL-safe: usa subquery escalar para manejar "no row" ─
  -- SELECT INTO sin STRICT deja la variable en NULL cuando no hay filas,
  -- aunque esté inicializada. La subquery escalar con COALESCE lo resuelve.
  SELECT COALESCE(
    (SELECT ps.current_stock
     FROM   product_stock ps
     WHERE  ps.product_id = p_product_id
       AND  ps.school_id  = p_school_id
     LIMIT  1),
    0
  ) INTO v_stock_before;

  -- ── Texto de auditoría ────────────────────────────────────────────────
  v_audit_reason := CASE
    WHEN p_uom_id IS NOT NULL THEN
      COALESCE(p_reason, 'Entrada de compra') ||
      format(' [Conversión: %s %s × %s un. = %s unidades base]',
        p_quantity, v_uom_name, v_factor, v_base_qty)
    ELSE
      COALESCE(p_reason, 'Entrada de compra registrada desde logística')
  END;

  -- ── Suprimir trigger genérico de ajuste_manual ───────────────────────
  PERFORM set_config('app.kardex_source', 'entry_rpc', true);

  -- ── Upsert de stock ───────────────────────────────────────────────────
  INSERT INTO product_stock (product_id, school_id, current_stock, is_enabled, last_updated)
  VALUES (p_product_id, p_school_id, v_base_qty, true, clock_timestamp())
  ON CONFLICT (product_id, school_id)
  DO UPDATE SET
    current_stock = product_stock.current_stock + v_base_qty,
    last_updated  = clock_timestamp();

  -- ── Stock después (leído de BD, no calculado en cliente) ──────────────
  SELECT ps.current_stock
  INTO   v_stock_after
  FROM   product_stock ps
  WHERE  ps.product_id = p_product_id
    AND  ps.school_id  = p_school_id;

  -- Sanity: si por alguna razón stock_after es NULL, usamos stock_before + base
  v_stock_after := COALESCE(v_stock_after, v_stock_before + v_base_qty);

  -- ── Kardex: entrada_compra con conversión documentada ────────────────
  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at,    reason
  ) VALUES (
    p_product_id,  p_school_id,
    'entrada_compra',
    v_base_qty,
    v_stock_before, v_stock_after,
    p_entry_id,    auth.uid(),
    clock_timestamp(),
    v_audit_reason
  );

  RETURN jsonb_build_object(
    'ok',       true,
    'base_qty', v_base_qty,
    'factor',   COALESCE(v_factor, 1),
    'uom_name', COALESCE(v_uom_name, 'unidad')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_product_stock(uuid, uuid, integer, uuid, text, uuid)
  TO authenticated, service_role;

SELECT '✅ HOTFIX DEFINITIVO: increment_product_stock canónico (NULL-safe, sin ambigüedad)' AS resultado;
