-- Verificar si hay triggers o funciones que modifiquen payment_status
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'transactions';

-- Verificar valor por defecto de payment_status
SELECT 
  column_name,
  column_default,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';
