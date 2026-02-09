-- Ver la definición completa de la tabla transactions
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions'
ORDER BY ordinal_position;

-- Ver la última transacción creada de Profesor 2
SELECT 
  id,
  created_at,
  description,
  amount,
  payment_status,
  payment_method,
  teacher_id,
  tp.full_name as profesor
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name = 'Profesor 2'
ORDER BY t.created_at DESC
LIMIT 5;
