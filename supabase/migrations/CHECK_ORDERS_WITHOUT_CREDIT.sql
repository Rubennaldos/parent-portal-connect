-- =====================================================
-- VERIFICAR PEDIDOS "SIN CRÉDITO" EN LA BD
-- =====================================================

-- 1. Ver todos los pedidos de hoy y sus estados
SELECT 
  '📋 PEDIDOS DE HOY' as tipo,
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.payment_status,
  COALESCE(s.full_name, tp.full_name, lo.manual_name) as cliente,
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'Estudiante'
    WHEN lo.teacher_id IS NOT NULL THEN 'Profesor'
    WHEN lo.manual_name IS NOT NULL THEN 'Manual'
    ELSE 'Desconocido'
  END as tipo_cliente,
  lo.final_price,
  lo.created_at
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date >= CURRENT_DATE
ORDER BY lo.created_at DESC;

-- 2. Ver si hay pedidos que NO tienen transacción asociada (sin crédito?)
SELECT 
  '🔍 PEDIDOS SIN TRANSACCIÓN' as tipo,
  lo.id as order_id,
  lo.order_date,
  COALESCE(s.full_name, tp.full_name, lo.manual_name) as cliente,
  lo.final_price,
  lo.payment_status,
  lo.created_at
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
LEFT JOIN transactions t ON (
  (lo.student_id IS NOT NULL AND t.student_id = lo.student_id AND t.metadata->>'lunch_order_id' = lo.id::text)
  OR (lo.teacher_id IS NOT NULL AND t.teacher_id = lo.teacher_id AND t.metadata->>'lunch_order_id' = lo.id::text)
)
WHERE lo.order_date >= CURRENT_DATE
  AND t.id IS NULL
  AND lo.is_cancelled = false
ORDER BY lo.created_at DESC;

-- 3. Ver pedidos por tipo de pago
SELECT 
  '💰 PEDIDOS POR TIPO DE PAGO' as tipo,
  lo.payment_status,
  COUNT(*) as cantidad,
  SUM(lo.final_price) as total_monto
FROM lunch_orders lo
WHERE lo.order_date >= CURRENT_DATE
  AND lo.is_cancelled = false
GROUP BY lo.payment_status
ORDER BY lo.payment_status;

-- 4. Ver pedidos que se hicieron con "free_account" (sin crédito)
SELECT 
  '🆓 PEDIDOS DE CUENTAS FREE' as tipo,
  lo.id,
  s.full_name as estudiante,
  s.free_account,
  lo.order_date,
  lo.payment_status,
  lo.final_price,
  lo.created_at
FROM lunch_orders lo
JOIN students s ON lo.student_id = s.id
WHERE lo.order_date >= CURRENT_DATE
  AND s.free_account = true
  AND lo.is_cancelled = false
ORDER BY lo.created_at DESC;

-- 5. Ver si hay pedidos con payment_status = NULL
SELECT 
  '❓ PEDIDOS CON PAYMENT_STATUS NULL' as tipo,
  lo.id,
  COALESCE(s.full_name, tp.full_name, lo.manual_name) as cliente,
  lo.payment_status,
  lo.order_date,
  lo.created_at
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date >= CURRENT_DATE
  AND lo.payment_status IS NULL
  AND lo.is_cancelled = false
ORDER BY lo.created_at DESC;
