-- =====================================================
-- FIX: Corregir transacciones existentes marcadas como PAGADAS cuando deberían ser PENDIENTES
-- Fecha: 2026-02-09
-- =====================================================

-- 1. ACTUALIZAR transacciones de PROFESORES que están como 'paid' pero deberían ser 'pending'
-- (Los profesores NUNCA pagan al momento, siempre es crédito/deuda)
UPDATE transactions
SET 
  payment_status = 'pending',
  payment_method = NULL
WHERE 
  teacher_id IS NOT NULL
  AND payment_status = 'paid'
  AND type = 'purchase'
  AND amount < 0; -- Solo deudas (montos negativos)

-- 2. Ver cuántas transacciones de profesores se actualizaron
SELECT 
  '✅ Transacciones de PROFESORES corregidas' as info,
  COUNT(*) as cantidad_actualizada
FROM transactions
WHERE 
  teacher_id IS NOT NULL
  AND payment_status = 'pending'
  AND type = 'purchase'
  AND amount < 0
  AND updated_at >= NOW() - INTERVAL '1 minute';

-- 3. OPCIONAL: Eliminar transacciones duplicadas de almuerzos con saldo prepagado
-- (Estas transacciones NO deberían existir porque el pago ya se registró en la recarga)
-- NOTA: Solo ejecutar esto si estás SEGURO de que son duplicados

-- Mostrar transacciones sospechosas (para revisar antes de eliminar)
SELECT 
  '⚠️ REVISAR: Transacciones de almuerzos potencialmente duplicadas (saldo prepagado)' as advertencia,
  t.id,
  t.created_at,
  t.description,
  t.amount,
  t.payment_status,
  s.full_name as estudiante,
  s.free_account
FROM transactions t
LEFT JOIN students s ON t.student_id = s.id
WHERE 
  t.student_id IS NOT NULL
  AND t.type = 'purchase'
  AND t.payment_status = 'paid'
  AND t.description LIKE 'Almuerzo%'
  AND s.free_account = false -- Estudiantes con saldo prepagado
ORDER BY t.created_at DESC;

-- 4. Ver resumen de transacciones de PROFESOR 2 después de la corrección
SELECT 
  '📊 RESUMEN: Transacciones de Profesor 2 después de corrección' as info,
  t.id,
  t.description,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.created_at,
  tp.full_name as profesor
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name = 'Profesor 2'
ORDER BY t.created_at DESC;
