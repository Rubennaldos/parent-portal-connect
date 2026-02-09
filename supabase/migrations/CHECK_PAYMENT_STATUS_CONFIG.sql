-- =====================================================
-- VERIFICAR CONFIGURACIÓN ACTUAL DE PAYMENT_STATUS
-- =====================================================

-- 1️⃣ Verificar el DEFAULT actual de payment_status en transactions
SELECT 
  '📋 DEFAULT ACTUAL' as paso,
  column_name,
  column_default,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';

-- 2️⃣ Ver las últimas transacciones creadas HOY
SELECT 
  '🔍 ÚLTIMAS TRANSACCIONES HOY' as paso,
  id,
  type,
  amount,
  description,
  payment_status,
  payment_method,
  teacher_id,
  student_id,
  created_at
FROM transactions
WHERE created_at >= CURRENT_DATE
ORDER BY created_at DESC
LIMIT 10;

-- 3️⃣ Contar transacciones incorrectas HOY
SELECT 
  '❌ TRANSACCIONES INCORRECTAS HOY' as problema,
  COUNT(*) as cantidad,
  CASE 
    WHEN COUNT(*) > 0 THEN '⚠️ HAY TRANSACCIONES CON PAID INCORRECTO'
    ELSE '✅ No hay problemas'
  END as estado
FROM transactions
WHERE created_at >= CURRENT_DATE
  AND payment_status = 'paid'
  AND (
    (teacher_id IS NOT NULL AND payment_method IS NULL)
    OR (type = 'purchase' AND amount < 0 AND payment_method IS NULL)
  );

-- 4️⃣ Ver esas transacciones incorrectas en detalle
SELECT 
  '🚨 DETALLE DE TRANSACCIONES INCORRECTAS' as paso,
  id,
  type,
  amount,
  description,
  payment_status,
  payment_method,
  teacher_id,
  student_id,
  created_at
FROM transactions
WHERE created_at >= CURRENT_DATE
  AND payment_status = 'paid'
  AND (
    (teacher_id IS NOT NULL AND payment_method IS NULL)
    OR (type = 'purchase' AND amount < 0 AND payment_method IS NULL)
  )
ORDER BY created_at DESC;
