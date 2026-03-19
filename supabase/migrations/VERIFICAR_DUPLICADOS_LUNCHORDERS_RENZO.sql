-- ============================================================
-- VERIFICAR: ¿Hay lunch_orders duplicados para Renzo?
-- ¿Dos pedidos para la misma fecha?
-- ============================================================

-- ── 1. Listar TODOS los lunch_orders de Renzo con su estado ──
SELECT
  lo.id             AS lunch_order_id,
  lo.order_date,
  lo.status         AS estado_pedido,
  lo.is_cancelled,
  lc.name           AS categoria,
  t.payment_status  AS estado_pago,
  t.metadata->>'recharge_request_id' AS voucher_que_lo_pago
FROM lunch_orders lo
JOIN lunch_categories lc ON lc.id = lo.category_id
LEFT JOIN transactions t
  ON t.metadata->>'lunch_order_id' = lo.id::text
  AND t.payment_status != 'cancelled'
WHERE lo.student_id = '48f287ce-737a-4598-a0fb-20b22d522159'
ORDER BY lo.order_date, lo.created_at;


-- ── 2. ¿Cuántos pedidos por fecha? (detecta duplicados) ──────
SELECT
  lo.order_date,
  COUNT(*) AS cantidad_pedidos_ese_dia,
  STRING_AGG(lo.id::text, ' | ') AS ids_pedidos,
  STRING_AGG(lo.status, ' | ')   AS estados
FROM lunch_orders lo
WHERE lo.student_id = '48f287ce-737a-4598-a0fb-20b22d522159'
  AND lo.is_cancelled = false
GROUP BY lo.order_date
HAVING COUNT(*) > 1
ORDER BY lo.order_date;


-- ── 3. Resumen: ¿cuántas fechas únicas vs pedidos totales? ───
SELECT
  COUNT(*)                        AS total_pedidos,
  COUNT(DISTINCT order_date)      AS fechas_unicas,
  COUNT(*) - COUNT(DISTINCT order_date) AS pedidos_duplicados
FROM lunch_orders
WHERE student_id = '48f287ce-737a-4598-a0fb-20b22d522159'
  AND is_cancelled = false;
