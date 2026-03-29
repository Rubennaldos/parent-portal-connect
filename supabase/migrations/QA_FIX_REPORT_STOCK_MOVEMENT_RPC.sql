-- QA FIX — Vector 4: Fatiga de memoria en LogisticsMovementReport
-- PROBLEMA: El frontend traía miles de transaction_items en batches y los agrupaba
-- en JS con .reduce(), lo que en rangos grandes (1 año) colapsa el navegador.
-- SOLUCIÓN: RPC que hace GROUP BY en la BD y devuelve solo las filas agregadas.

CREATE OR REPLACE FUNCTION report_stock_movement(
  p_start_utc  timestamptz,
  p_end_utc    timestamptz,
  p_school_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  product_name text,
  school_name  text,
  school_id    uuid,
  qty_sold     bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ti.product_name,
    s.name           AS school_name,
    t.school_id      AS school_id,
    SUM(ti.quantity) AS qty_sold
  FROM transactions t
  JOIN transaction_items ti ON ti.transaction_id = t.id
  JOIN schools           s  ON s.id = t.school_id
  WHERE t.type           = 'purchase'
    AND t.payment_status != 'cancelled'          -- Vector 2: excluye anuladas
    AND t.created_at    >= p_start_utc
    AND t.created_at    <  p_end_utc
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
  GROUP BY ti.product_name, s.name, t.school_id
  ORDER BY qty_sold DESC;
$$;

GRANT EXECUTE ON FUNCTION report_stock_movement(timestamptz, timestamptz, uuid)
  TO authenticated, service_role;
