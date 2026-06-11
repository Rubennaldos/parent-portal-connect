-- ============================================================
-- Stock Live — Bitácora por producto + sede (una fila = un par)
-- ============================================================
-- Reglas:
--   • Solo pos_stock_movements (kardex SSOT de inventario POS/logística)
--   • Filtro OBLIGATORIO: product_id AND school_id (nunca todas las sedes)
--   • Paginación en servidor (default 10, máx 50 por página)
--   • Fecha/hora: reloj DB en America/Lima
--   • SECURITY INVOKER: respeta RLS psm_select de pos_stock_movements
-- ============================================================

CREATE OR REPLACE VIEW v_product_stock_bitacora
WITH (security_invoker = true)
AS
SELECT
  psm.id,
  psm.product_id,
  psm.school_id,
  psm.quantity_delta,
  CASE
    WHEN psm.quantity_delta > 0 THEN '+' || psm.quantity_delta::text
    ELSE psm.quantity_delta::text
  END AS delta_label,
  to_char(
    timezone('America/Lima', psm.created_at),
    'DD/MM/YYYY HH24:MI'
  ) AS occurred_at_lima,
  psm.created_at
FROM pos_stock_movements psm;

COMMENT ON VIEW v_product_stock_bitacora IS
  'Lectura delgada del kardex por producto+sede. RLS de pos_stock_movements aplica (security_invoker).';

GRANT SELECT ON v_product_stock_bitacora TO authenticated;

-- ── RPC paginado: bitácora de UNA fila (producto en UNA sede) ───────────────

CREATE OR REPLACE FUNCTION get_product_stock_bitacora(
  p_product_id uuid,
  p_school_id  uuid,
  p_limit      integer DEFAULT 10,
  p_offset     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit   integer;
  v_offset  integer;
  v_has_more boolean;
  v_items   jsonb;
BEGIN
  IF p_product_id IS NULL OR p_school_id IS NULL THEN
    RAISE EXCEPTION 'BITACORA_PARAMS: product_id y school_id son obligatorios (una sede, un producto).';
  END IF;

  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  WITH raw AS (
    SELECT
      b.quantity_delta,
      b.delta_label,
      b.occurred_at_lima,
      b.created_at
    FROM v_product_stock_bitacora b
    WHERE b.product_id = p_product_id
      AND b.school_id  = p_school_id
    ORDER BY b.created_at DESC
    LIMIT v_limit + 1
    OFFSET v_offset
  ),
  cnt AS (
    SELECT count(*)::integer AS n FROM raw
  ),
  trimmed AS (
    SELECT quantity_delta, delta_label, occurred_at_lima, created_at
    FROM raw
    ORDER BY created_at DESC
    LIMIT v_limit
  )
  SELECT
    (SELECT n FROM cnt) > v_limit,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'quantity_delta',   t.quantity_delta,
            'delta_label',      t.delta_label,
            'occurred_at_lima', t.occurred_at_lima
          )
          ORDER BY t.created_at DESC
        )
        FROM trimmed t
      ),
      '[]'::jsonb
    )
  INTO v_has_more, v_items;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'school_id',  p_school_id,
    'items',      COALESCE(v_items, '[]'::jsonb),
    'has_more',   COALESCE(v_has_more, false),
    'limit',      v_limit,
    'offset',     v_offset
  );
END;
$$;

COMMENT ON FUNCTION get_product_stock_bitacora(uuid, uuid, integer, integer) IS
  'Bitácora paginada de movimientos de stock para un producto en una sede concreta. '
  'No consulta otras sedes: WHERE product_id = p_product_id AND school_id = p_school_id. '
  'Respeta RLS (SECURITY INVOKER).';

GRANT EXECUTE ON FUNCTION get_product_stock_bitacora(uuid, uuid, integer, integer)
  TO authenticated, service_role;

SELECT 'OK: v_product_stock_bitacora + get_product_stock_bitacora' AS resultado;
