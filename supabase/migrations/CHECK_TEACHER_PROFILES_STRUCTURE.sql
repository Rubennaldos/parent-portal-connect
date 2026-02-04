-- =====================================================
-- VERIFICAR ESTRUCTURA DE teacher_profiles
-- =====================================================

-- Ver columnas de teacher_profiles
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'teacher_profiles'
ORDER BY ordinal_position;

-- Ver si tienen balance
SELECT 
  id,
  full_name,
  balance,
  school_id_1
FROM teacher_profiles
LIMIT 5;

-- Ver transacciones de profesores
SELECT 
  t.id,
  t.teacher_id,
  tp.full_name,
  t.type,
  t.amount,
  t.payment_status,
  t.description,
  t.created_at
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.teacher_id IS NOT NULL
ORDER BY t.created_at DESC
LIMIT 10;
