-- ============================================================
-- POS STOCK SNAPSHOT (COALESCE 0)
-- ============================================================
-- Objetivo:
-- 1) Entregar al POS un stock por producto+sede sin NULL.
-- 2) Mantener lectura directa de BD en una sola consulta por lote.
--
-- Nota:
-- - Si no existe fila en product_stock para ese producto+sede, retorna 0.
-- - Solo considera filas habilitadas (is_enabled = true) para stock operativo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pos_stock_snapshot(
  p_school_id   uuid,
  p_product_ids uuid[]
)
RETURNS TABLE (
  product_id    uuid,
  current_stock integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pid AS product_id,
    COALESCE(ps.current_stock, 0)::integer AS current_stock
  FROM unnest(COALESCE(p_product_ids, ARRAY[]::uuid[])) AS pid
  LEFT JOIN LATERAL (
    SELECT s.current_stock
    FROM product_stock s
    WHERE s.product_id = pid
      AND s.school_id  = p_school_id
      AND s.is_enabled = true
    LIMIT 1
  ) ps ON true;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_stock_snapshot(uuid, uuid[])
TO authenticated, service_role;

SELECT 'OK: get_pos_stock_snapshot con COALESCE(0) listo' AS resultado;
