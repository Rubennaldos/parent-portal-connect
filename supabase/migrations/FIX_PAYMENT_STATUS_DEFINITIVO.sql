-- =====================================================
-- CORRECCIÓN DEFINITIVA: PAYMENT_STATUS
-- =====================================================
-- Este script GARANTIZA que las transacciones se creen correctamente

-- PASO 1: Verificar el estado actual
SELECT 
  '📋 ESTADO ACTUAL DEL DEFAULT' as paso,
  column_name,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';

-- PASO 2: FORZAR el cambio del DEFAULT a NULL
ALTER TABLE public.transactions 
ALTER COLUMN payment_status DROP DEFAULT;

ALTER TABLE public.transactions 
ALTER COLUMN payment_status SET DEFAULT NULL;

-- PASO 3: Verificar que se aplicó
SELECT 
  '✅ DESPUÉS DEL CAMBIO' as paso,
  column_name,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';

-- PASO 4: Corregir transacciones INCORRECTAS de HOY
-- Solo las que tienen payment_status = 'paid' cuando deberían ser 'pending'

-- 4a. Profesores (pedidos de almuerzo)
UPDATE public.transactions
SET 
  payment_status = 'pending',
  payment_method = NULL
WHERE 
  created_at >= CURRENT_DATE
  AND teacher_id IS NOT NULL
  AND payment_status = 'paid'
  AND type = 'purchase'
  AND amount < 0
  AND (payment_method IS NULL OR payment_method = 'teacher_account');

-- 4b. Ventas manuales "Pagar Luego" (manual_client_name existe)
UPDATE public.transactions
SET 
  payment_status = 'pending',
  payment_method = NULL
WHERE 
  created_at >= CURRENT_DATE
  AND manual_client_name IS NOT NULL
  AND payment_status = 'paid'
  AND type = 'purchase'
  AND amount < 0;

-- PASO 5: Ver cuántas se corrigieron
SELECT 
  '📊 RESULTADO DE LA CORRECCIÓN' as resultado,
  COUNT(*) as transacciones_corregidas
FROM public.transactions
WHERE 
  created_at >= CURRENT_DATE
  AND payment_status = 'pending'
  AND (
    (teacher_id IS NOT NULL AND payment_method IS NULL)
    OR manual_client_name IS NOT NULL
  );

-- PASO 6: Ver las transacciones corregidas
SELECT 
  '✅ TRANSACCIONES AHORA CORREGIDAS' as estado,
  id,
  type,
  amount,
  description,
  payment_status,
  payment_method,
  teacher_id,
  manual_client_name,
  created_at
FROM public.transactions
WHERE 
  created_at >= CURRENT_DATE
  AND payment_status = 'pending'
  AND (
    teacher_id IS NOT NULL 
    OR manual_client_name IS NOT NULL
  )
ORDER BY created_at DESC
LIMIT 10;
