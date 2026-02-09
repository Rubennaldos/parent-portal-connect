-- Verificar triggers en la tabla transactions
SELECT 
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'transactions';

-- Ver la última transacción creada (para verificar el payment_status)
SELECT 
  t.id,
  t.created_at,
  t.description,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.teacher_id,
  t.student_id,
  tp.full_name as profesor
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
ORDER BY t.created_at DESC
LIMIT 1;

-- Verificar que el default se cambió
SELECT 
  column_name,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';
