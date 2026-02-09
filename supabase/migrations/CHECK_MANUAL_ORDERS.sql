-- =====================================================
-- VERIFICAR PEDIDOS SIN CRÉDITO (SIMPLIFICADO)
-- =====================================================

-- 1. Ver todos los pedidos de hoy
SELECT 
  '📋 PEDIDOS DE HOY' as tipo,
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  COALESCE(s.full_name, tp.full_name, lo.manual_name) as cliente,
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'Estudiante'
    WHEN lo.teacher_id IS NOT NULL THEN 'Profesor'
    WHEN lo.manual_name IS NOT NULL THEN 'Manual'
    ELSE 'Desconocido'
  END as tipo_cliente,
  lo.payment_method,
  lo.final_price,
  lo.created_at
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date >= CURRENT_DATE
  AND lo.is_cancelled = false
ORDER BY lo.created_at DESC;

-- 2. Ver pedidos "SIN CRÉDITO" (manuales)
SELECT 
  '🛒 PEDIDOS MANUALES (SIN CRÉDITO)' as tipo,
  lo.id,
  lo.manual_name as nombre_cliente,
  lo.order_date,
  lo.status,
  lo.payment_method,
  lo.payment_details,
  lo.final_price,
  lo.created_at
FROM lunch_orders lo
WHERE lo.order_date >= CURRENT_DATE
  AND lo.is_cancelled = false
  AND lo.manual_name IS NOT NULL
ORDER BY lo.created_at DESC;

-- 3. Contar por tipo
SELECT 
  '📊 RESUMEN POR TIPO' as tipo,
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'Con Crédito - Estudiante'
    WHEN lo.teacher_id IS NOT NULL THEN 'Con Crédito - Profesor'
    WHEN lo.manual_name IS NOT NULL THEN 'Sin Crédito - Manual'
    ELSE 'Desconocido'
  END as tipo_pedido,
  COUNT(*) as cantidad
FROM lunch_orders lo
WHERE lo.order_date >= CURRENT_DATE
  AND lo.is_cancelled = false
GROUP BY 
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'Con Crédito - Estudiante'
    WHEN lo.teacher_id IS NOT NULL THEN 'Con Crédito - Profesor'
    WHEN lo.manual_name IS NOT NULL THEN 'Sin Crédito - Manual'
    ELSE 'Desconocido'
  END
ORDER BY cantidad DESC;
