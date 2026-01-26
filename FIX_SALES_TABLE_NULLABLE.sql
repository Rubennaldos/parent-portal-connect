-- Hacer student_id OPCIONAL en tabla sales
-- Para permitir ventas a clientes genéricos

ALTER TABLE public.sales 
ALTER COLUMN student_id DROP NOT NULL;

-- Verificar el cambio
SELECT 
  column_name, 
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'sales'
  AND column_name = 'student_id';
