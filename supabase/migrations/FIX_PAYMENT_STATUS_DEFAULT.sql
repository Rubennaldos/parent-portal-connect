-- =====================================================
-- FIX: Cambiar el valor por defecto de payment_status
-- =====================================================

-- PROBLEMA: La columna payment_status tiene un valor por defecto de 'paid'
-- SOLUCIÓN: Cambiar el valor por defecto a NULL

-- 1. Eliminar el valor por defecto actual
ALTER TABLE public.transactions 
ALTER COLUMN payment_status DROP DEFAULT;

-- 2. Establecer el nuevo valor por defecto como NULL (o 'pending' si prefieres)
-- NULL es mejor porque fuerza a especificar explícitamente el estado en cada transacción
ALTER TABLE public.transactions 
ALTER COLUMN payment_status SET DEFAULT NULL;

-- 3. Verificar el cambio
SELECT 
  column_name,
  column_default,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';

-- Resultado esperado:
-- | column_name    | column_default | is_nullable | data_type |
-- | payment_status | NULL           | YES         | text      |
