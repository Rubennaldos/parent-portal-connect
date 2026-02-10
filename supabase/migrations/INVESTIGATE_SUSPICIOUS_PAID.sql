-- =====================================================
-- INVESTIGAR TRANSACCIONES SOSPECHOSAS EN "PAGOS REALIZADOS"
-- =====================================================

-- 1️⃣ Ver transacciones PAID sin número de operación (SOSPECHOSAS)
SELECT 
  '🚨 PAID SIN NÚMERO DE OPERACIÓN' as tipo,
  t.id,
  COALESCE(s.full_name, tp.full_name, t.manual_client_name, 'Sin cliente') as cliente,
  t.description,
  t.amount,
  t.payment_method,
  t.operation_number,
  t.payment_status,
  t.created_at,
  CASE 
    WHEN s.id IS NOT NULL THEN 'Estudiante'
    WHEN tp.id IS NOT NULL THEN 'Profesor'
    WHEN t.manual_client_name IS NOT NULL THEN 'Manual'
    ELSE 'Genérico'
  END as tipo_cliente
FROM transactions t
LEFT JOIN students s ON t.student_id = s.id
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.payment_status = 'paid'
  AND t.operation_number IS NULL
  AND t.payment_method IS NOT NULL
  AND t.payment_method != 'efectivo'
  AND t.payment_method != 'teacher_account' -- Excluir cuentas de profesor (crédito)
ORDER BY t.created_at DESC
LIMIT 20;

-- 2️⃣ Ver transacciones de PROFESORES que están como PAID cuando deberían ser PENDING
SELECT 
  '🚨 PROFESORES CON PAID INCORRECTO' as tipo,
  tp.full_name as profesor,
  t.description,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.operation_number,
  t.created_at
FROM transactions t
INNER JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.payment_status = 'paid'
  AND t.type = 'purchase'
  AND t.amount < 0
  AND (
    t.payment_method IS NULL 
    OR t.payment_method = 'teacher_account'
    OR (t.payment_method IS NOT NULL AND t.operation_number IS NULL AND t.payment_method != 'efectivo')
  )
ORDER BY t.created_at DESC
LIMIT 15;

-- 3️⃣ Ver todas las transacciones PAID del último día
SELECT 
  '📊 PAID ÚLTIMAS 24H' as tipo,
  COALESCE(s.full_name, tp.full_name, t.manual_client_name, '🛒 Cliente Genérico') as cliente,
  t.payment_method,
  t.operation_number,
  t.amount,
  t.created_at,
  p.full_name as registrado_por,
  p.role as cargo_registrador
FROM transactions t
LEFT JOIN students s ON t.student_id = s.id
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
LEFT JOIN profiles p ON t.created_by = p.id
WHERE t.payment_status = 'paid'
  AND t.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY t.created_at DESC;

-- 4️⃣ Contar métodos de pago sin número de operación
SELECT 
  '📊 MÉTODOS SIN NÚMERO' as tipo,
  payment_method,
  COUNT(*) as cantidad,
  SUM(ABS(amount)) as total_monto
FROM transactions
WHERE payment_status = 'paid'
  AND operation_number IS NULL
  AND payment_method IS NOT NULL
GROUP BY payment_method
ORDER BY cantidad DESC;
