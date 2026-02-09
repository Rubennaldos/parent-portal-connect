-- =====================================================
-- SOLUCIÓN DEFINITIVA: Cambiar DEFAULT de payment_status
-- =====================================================

-- Ver el estado actual
SELECT 
  '🔍 ESTADO ACTUAL' as paso,
  column_name,
  column_default,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';

-- Cambiar el default a NULL
ALTER TABLE public.transactions 
ALTER COLUMN payment_status DROP DEFAULT;

ALTER TABLE public.transactions 
ALTER COLUMN payment_status SET DEFAULT NULL;

-- Verificar el cambio
SELECT 
  '✅ DESPUÉS DEL CAMBIO' as paso,
  column_name,
  column_default,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';

-- AHORA: Actualizar las transacciones INCORRECTAS que se crearon hoy con 'paid' cuando deberían ser 'pending'
-- Solo las que tienen teacher_id (profesores) y NO tienen payment_method
UPDATE public.transactions
SET 
  payment_status = 'pending',
  payment_method = NULL
WHERE 
  teacher_id IS NOT NULL
  AND payment_status = 'paid'
  AND type = 'purchase'
  AND amount < 0
  AND (payment_method IS NULL OR payment_method = 'teacher_account')
  AND created_at >= CURRENT_DATE;

-- Ver cuántas se actualizaron
SELECT 
  '📊 TRANSACCIONES CORREGIDAS HOY' as resultado,
  COUNT(*) as cantidad_actualizada
FROM public.transactions
WHERE 
  teacher_id IS NOT NULL
  AND payment_status = 'pending'
  AND type = 'purchase'
  AND amount < 0
  AND created_at >= CURRENT_DATE;
