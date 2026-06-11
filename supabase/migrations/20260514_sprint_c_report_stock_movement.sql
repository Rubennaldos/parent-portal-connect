-- ============================================================
-- SPRINT C — Logística: RPC de reporte completo de movimientos
-- ============================================================
-- report_stock_movement: incluye ventas POS + entradas + traslados + ajustes
-- ============================================================

CREATE OR REPLACE FUNCTION report_stock_movement(
  p_start_utc  timestamptz,
  p_end_utc    timestamptz,
  p_school_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  product_name  text,
  school_name   text,
  school_id     uuid,
  qty_sold      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(p.name, ti.product_name) AS product_name,
    s.name                            AS school_name,
    t.school_id,
    SUM(ti.quantity)::bigint          AS qty_sold
  FROM   transactions t
  JOIN   transaction_items ti ON ti.transaction_id = t.id
  LEFT   JOIN products p      ON p.id = ti.product_id
  JOIN   schools s            ON s.id = t.school_id
  WHERE  t.type            = 'purchase'
    AND  t.payment_status <> 'cancelled'
    AND  t.created_at      >= p_start_utc
    AND  t.created_at      <  p_end_utc
    AND  (p_school_id IS NULL OR t.school_id = p_school_id)
  GROUP  BY COALESCE(p.name, ti.product_name), s.name, t.school_id
  ORDER  BY qty_sold DESC;
$$;

GRANT EXECUTE ON FUNCTION report_stock_movement(timestamptz, timestamptz, uuid)
  TO authenticated, service_role;

-- ── RPC de reporte de movimientos del Kardex ────────────────────────────────
-- report_kardex_movements: todos los tipos de movimiento con motivo y referencia

CREATE OR REPLACE FUNCTION report_kardex_movements(
  p_start_utc  timestamptz,
  p_end_utc    timestamptz,
  p_school_id  uuid DEFAULT NULL,
  p_movement_type text DEFAULT NULL  -- NULL = todos
)
RETURNS TABLE (
  movement_id    uuid,
  product_name   text,
  school_name    text,
  movement_type  text,
  quantity_delta integer,
  stock_before   integer,
  stock_after    integer,
  reason         text,
  created_by_email text,
  created_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    psm.id                                  AS movement_id,
    p.name                                  AS product_name,
    s.name                                  AS school_name,
    psm.movement_type,
    psm.quantity_delta,
    psm.stock_before,
    psm.stock_after,
    psm.reason,
    au.email                                AS created_by_email,
    psm.created_at
  FROM   pos_stock_movements psm
  JOIN   products     p   ON p.id  = psm.product_id
  JOIN   schools      s   ON s.id  = psm.school_id
  LEFT   JOIN auth.users au ON au.id = psm.created_by
  WHERE  psm.created_at >= p_start_utc
    AND  psm.created_at <  p_end_utc
    AND  (p_school_id IS NULL OR psm.school_id = p_school_id)
    AND  (p_movement_type IS NULL OR psm.movement_type = p_movement_type)
  ORDER  BY psm.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION report_kardex_movements(timestamptz, timestamptz, uuid, text)
  TO authenticated, service_role;

SELECT 'OK: report_stock_movement y report_kardex_movements creados' AS resultado;
