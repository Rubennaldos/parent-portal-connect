-- =====================================================================
-- DIAGNÓSTICO DETALLADO: Mia Verano Francia
-- Desglose hora por hora de lo que pasó
-- =====================================================================

-- 1. TIMELINE COMPLETO: Todas las transacciones en orden cronológico
SELECT 
  'TX' AS tipo,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_lima,
  t.payment_status AS estado,
  t.payment_method AS metodo,
  t.amount AS monto,
  t.ticket_code AS ticket,
  t.description AS detalle,
  t.metadata->>'order_date' AS dia_almuerzo,
  t.metadata->>'approved_at' AS aprobado_en,
  t.metadata->>'reference_code' AS num_operacion,
  t.metadata->>'recharge_request_id' AS voucher_id
FROM transactions t
WHERE t.student_id = 'a24146ba-0f14-4af9-9ca6-74fde859cec0'
  AND t.is_deleted = false
ORDER BY t.created_at ASC;

-- 2. VOUCHERS del padre (todos los campos)
SELECT 
  rr.id AS voucher_id,
  rr.created_at AT TIME ZONE 'America/Lima' AS subido_el,
  rr.approved_at AT TIME ZONE 'America/Lima' AS aprobado_el,
  rr.amount AS monto,
  rr.status,
  rr.request_type,
  rr.description,
  rr.lunch_order_ids,
  rr.paid_transaction_ids,
  rr.voucher_url
FROM recharge_requests rr
WHERE rr.student_id = 'a24146ba-0f14-4af9-9ca6-74fde859cec0'
ORDER BY rr.created_at;

-- 3. PEDIDOS DE ALMUERZO (semana 9-14 marzo)
SELECT 
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.payment_method,
  lo.final_price,
  lo.base_price,
  lo.quantity,
  lo.created_at AT TIME ZONE 'America/Lima' AS pedido_creado
FROM lunch_orders lo
WHERE lo.student_id = 'a24146ba-0f14-4af9-9ca6-74fde859cec0'
ORDER BY lo.order_date;

-- 4. RESUMEN: Cuánto debe, cuánto pagó, cuánto queda
SELECT 
  payment_status,
  COUNT(*) AS cantidad,
  SUM(ABS(amount)) AS total
FROM transactions
WHERE student_id = 'a24146ba-0f14-4af9-9ca6-74fde859cec0'
  AND is_deleted = false
  AND type = 'purchase'
GROUP BY payment_status
ORDER BY payment_status;

-- 5. CUENTA DUPLICADA: "Mia Verano Franci" (sin la a)
SELECT 
  COUNT(*) AS total_transacciones,
  SUM(ABS(amount)) AS total_monto
FROM transactions
WHERE student_id = 'edaf1c8f-20e6-4c3e-a5db-9fbbd9cb7135'
  AND is_deleted = false;
