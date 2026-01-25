-- Verificar si existen las funciones necesarias para el delay
SELECT 
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_name IN (
  'get_purchase_visibility_delay',
  'get_visibility_cutoff_date'
)
AND routine_schema = 'public';
