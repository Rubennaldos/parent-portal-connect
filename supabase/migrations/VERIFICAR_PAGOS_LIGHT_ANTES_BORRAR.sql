-- =====================================================
-- VERIFICAR ESTADO DE PAGOS de los 8 pedidos
-- ANTES de borrar cualquier cosa
-- =====================================================

-- 1. Ver si los pedidos tienen transacciones asociadas (pagadas o pendientes)
SELECT 
  lo.id                                          AS order_id,
  lo.order_date,
  lc.name                                        AS categoria,
  COALESCE(st.full_name, lo.manual_name)         AS alumno,
  lo.status                                      AS estado_pedido,
  lo.payment_method                              AS metodo_pago_pedido,
  t.id                                           AS transaccion_id,
  t.payment_status                               AS estado_transaccion,
  t.amount                                       AS monto_transaccion,
  t.payment_method                               AS metodo_pago_transaccion,
  t.ticket_code                                  AS ticket,
  t.created_at                                   AS fecha_transaccion,
  CASE
    WHEN t.id IS NULL                            THEN '❌ SIN TRANSACCIÓN'
    WHEN t.payment_status = 'paid'               THEN '✅ PAGADO'
    WHEN t.payment_status = 'pending'            THEN '⏳ PENDIENTE DE PAGO'
    ELSE t.payment_status
  END                                            AS resumen_pago
FROM lunch_orders lo
JOIN lunch_menus lm    ON lo.menu_id   = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
LEFT JOIN students st  ON lo.student_id = st.id
-- Buscar transacción vinculada por metadata
LEFT JOIN transactions t
  ON (t.metadata->>'lunch_order_id')::text = lo.id::text
WHERE lm.category_id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',  -- Almuerzo Light de Pescado
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'   -- Almuerzo Light de Pollo
)
AND lo.order_date >= '2026-03-09'
AND lo.is_cancelled = false
ORDER BY lo.order_date;


-- =====================================================
-- 2. Verificar si hay recharge_requests (vouchers) enviados para esos pedidos
-- =====================================================
SELECT 
  rr.id                  AS voucher_id,
  rr.status              AS estado_voucher,
  rr.request_type,
  rr.amount,
  rr.created_at,
  rr.lunch_order_ids,
  COALESCE(st.full_name, rr.manual_name) AS padre_o_alumno
FROM recharge_requests rr
LEFT JOIN students st ON rr.student_id = st.id
WHERE rr.lunch_order_ids && ARRAY(
  SELECT lo.id
  FROM lunch_orders lo
  JOIN lunch_menus lm ON lo.menu_id = lm.id
  WHERE lm.category_id IN (
    '8c2f88ed-211a-45e9-92f0-b905dae03daf',
    '95b11bbb-f0a5-4325-b29a-b96001d75f30'
  )
  AND lo.order_date >= '2026-03-09'
)
ORDER BY rr.created_at;
