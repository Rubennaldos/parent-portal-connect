-- =====================================================
-- AGREGAR COLUMNA manual_client_name A TRANSACTIONS
-- Para guardar el nombre del cliente cuando paga "sin crédito"
-- =====================================================

-- 1. Verificar si ya existe la columna
SELECT 
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name = 'manual_client_name';

-- 2. Agregar la columna si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'transactions' 
      AND column_name = 'manual_client_name'
  ) THEN
    ALTER TABLE transactions ADD COLUMN manual_client_name VARCHAR(255);
    RAISE NOTICE 'Columna manual_client_name agregada exitosamente';
  ELSE
    RAISE NOTICE 'La columna manual_client_name ya existe';
  END IF;
END $$;

-- 3. Verificar la estructura actualizada
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('student_id', 'teacher_id', 'manual_client_name', 'payment_status', 'school_id')
ORDER BY ordinal_position;
