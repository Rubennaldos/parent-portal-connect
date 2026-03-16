-- DIAGNÓSTICO: Camila Julca — ¿Por qué sigue apareciendo deuda de S/ 24?

-- Paso 1: Estado actual de todas las transacciones de Camila
SELECT 
  t.id,
  t.amount,
  t.payment_status,
  t.is_deleted,
  t.ticket_code,
  t.description,
  t.created_at,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE s.full_name ILIKE '%Camila%Julca%'
  AND t.is_deleted = false
ORDER BY t.created_at DESC;


-- Paso 2: El voucher aprobado de S/ 16.00 — ¿qué transacciones marcó como pagadas?
SELECT 
  rr.id AS voucher_id,
  rr.status,
  rr.request_type,
  rr.paid_transaction_ids,
  rr.lunch_order_ids,
  rr.amount,
  rr.created_at
FROM recharge_requests rr
JOIN students s ON rr.student_id = s.id
WHERE s.full_name ILIKE '%Camila%Julca%'
ORDER BY rr.created_at DESC;


-- Paso 3: El pedido de almuerzo manual que la mamá canceló — ¿sigue activo o cancelado?
SELECT 
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.cancelled_at,
  lo.cancellation_reason,
  lo.final_price
FROM lunch_orders lo
JOIN students s ON lo.student_id = s.id
WHERE s.full_name ILIKE '%Camila%Julca%'
ORDER BY lo.created_at DESC;
