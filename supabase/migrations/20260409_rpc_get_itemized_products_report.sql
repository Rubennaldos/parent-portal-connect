-- ============================================================
-- RPC: get_itemized_products_report
-- Fecha: 2026-04-09
-- Propósito: Reporte itemizado de ventas POS por producto,
--   agrupado SERVER-SIDE para no congelar el navegador.
--
-- Retorna dos secciones en un solo jsonb:
--
--  "ventas"  → agrupado por producto: qty vendida, revenue, precio promedio
--  "kardex"  → movimientos del POS por producto (ventas, ajustes, entradas)
--
-- Fuentes:
--   - transaction_items + transactions  → ventas reales
--   - pos_stock_movements               → kardex POS (venta_pos/ajuste_manual/entrada_compra)
--   - product_stock                     → stock actual
-- ============================================================

DROP FUNCTION IF EXISTS get_itemized_products_report(uuid, date, date);

CREATE OR REPLACE FUNCTION get_itemized_products_report(
  p_school_id  uuid  DEFAULT NULL,
  p_date_from  date  DEFAULT CURRENT_DATE,
  p_date_to    date  DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start  timestamptz := (p_date_from::text || 'T00:00:00-05:00')::timestamptz;
  v_period_end    timestamptz := (p_date_to::text   || 'T23:59:59-05:00')::timestamptz;
  v_ventas        jsonb;
  v_kardex        jsonb;
  v_stock_actual  jsonb;
BEGIN

  -- ══════════════════════════════════════════════════════════════════════════
  -- 1. VENTAS POR PRODUCTO — agrupado en servidor
  --    JOIN: transaction_items → transactions → products
  --    Solo ventas POS (lunch_order_id IS NULL)
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id',       sub.product_id,
      'product_name',     sub.product_name,
      'qty_sold',         sub.qty_sold,
      'revenue',          ROUND(sub.revenue, 2),
      'avg_unit_price',   ROUND(sub.avg_unit_price, 2),
      'min_price',        ROUND(sub.min_price, 2),
      'max_price',        ROUND(sub.max_price, 2),
      'ticket_count',     sub.ticket_count
    ) ORDER BY sub.revenue DESC
  )
  INTO v_ventas
  FROM (
    SELECT
      ti.product_id,
      COALESCE(ti.product_name, p.name, 'Sin nombre') AS product_name,
      SUM(ti.quantity)::integer                         AS qty_sold,
      SUM(ti.subtotal)                                  AS revenue,
      AVG(ti.unit_price)                                AS avg_unit_price,
      MIN(ti.unit_price)                                AS min_price,
      MAX(ti.unit_price)                                AS max_price,
      COUNT(DISTINCT t.id)::integer                     AS ticket_count
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    LEFT JOIN products p ON p.id = ti.product_id
    WHERE
      -- Solo ventas POS (excluye pagos de almuerzo)
      (t.metadata->>'lunch_order_id') IS NULL
      AND t.is_deleted  = false
      AND t.type        IN ('purchase', 'sale')
      AND t.payment_status <> 'cancelled'
      -- Cierre: ancla por created_at en Lima
      AND t.created_at >= v_period_start
      AND t.created_at <= v_period_end
      AND (p_school_id IS NULL OR t.school_id = p_school_id)
    GROUP BY ti.product_id, COALESCE(ti.product_name, p.name, 'Sin nombre')
  ) sub;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2. KARDEX POS — movimientos de stock por producto
  --    (venta_pos = salida automática, ajuste_manual = merma/corrección,
  --     entrada_compra = reposición desde compra)
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id',       sub.product_id,
      'product_name',     sub.product_name,
      'ventas_pos',       sub.ventas_pos,          -- cantidad saliente por venta
      'ajustes_manual',   sub.ajustes_manual,      -- merma / corrección (puede ser +/-)
      'entradas_compra',  sub.entradas_compra,     -- reposición de stock
      'net_delta',        sub.net_delta            -- cambio neto de stock en el período
    ) ORDER BY sub.ventas_pos ASC  -- más vendido primero
  )
  INTO v_kardex
  FROM (
    SELECT
      psm.product_id,
      COALESCE(p.name, 'Sin nombre') AS product_name,
      -- ventas POS: quantity_delta es negativo (sale stock)
      COALESCE(SUM(ABS(psm.quantity_delta)) FILTER (
        WHERE psm.movement_type = 'venta_pos' AND psm.quantity_delta < 0
      ), 0)::integer AS ventas_pos,
      -- ajustes manuales: merma u otras correcciones
      COALESCE(SUM(psm.quantity_delta) FILTER (
        WHERE psm.movement_type = 'ajuste_manual'
      ), 0)::integer AS ajustes_manual,
      -- entradas por compra: quantity_delta positivo
      COALESCE(SUM(psm.quantity_delta) FILTER (
        WHERE psm.movement_type = 'entrada_compra' AND psm.quantity_delta > 0
      ), 0)::integer AS entradas_compra,
      -- delta neto en el período
      COALESCE(SUM(psm.quantity_delta), 0)::integer AS net_delta
    FROM pos_stock_movements psm
    LEFT JOIN products p ON p.id = psm.product_id
    WHERE
      psm.created_at >= v_period_start
      AND psm.created_at <= v_period_end
      AND (p_school_id IS NULL OR psm.school_id = p_school_id)
    GROUP BY psm.product_id, COALESCE(p.name, 'Sin nombre')
  ) sub;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 3. STOCK ACTUAL — snapshot en tiempo real (no filtrado por fecha)
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id',    ps.product_id,
      'product_name',  COALESCE(p.name, 'Sin nombre'),
      'current_stock', ps.current_stock,
      'school_name',   COALESCE(s.name, '—')
    ) ORDER BY ps.current_stock ASC  -- stock bajo primero
  )
  INTO v_stock_actual
  FROM product_stock ps
  LEFT JOIN products p ON p.id = ps.product_id
  LEFT JOIN schools  s ON s.id = ps.school_id
  WHERE (p_school_id IS NULL OR ps.school_id = p_school_id)
    AND ps.current_stock >= 0;  -- excluye registros inválidos

  -- ══════════════════════════════════════════════════════════════════════════
  -- RESULTADO
  -- ══════════════════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'from',         p_date_from,
      'to',           p_date_to,
      'generated_at', NOW() AT TIME ZONE 'America/Lima',
      'timezone',     'America/Lima'
    ),
    'ventas',       COALESCE(v_ventas,       '[]'::jsonb),
    'kardex',       COALESCE(v_kardex,       '[]'::jsonb),
    'stock_actual', COALESCE(v_stock_actual, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_itemized_products_report(uuid, date, date)
  TO authenticated, service_role;
