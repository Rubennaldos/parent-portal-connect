-- =====================================================
-- VERIFICAR TRIGGERS QUE PUEDAN ESTAR MODIFICANDO PAYMENT_STATUS
-- =====================================================

-- 1️⃣ Ver TODOS los triggers en la tabla transactions
SELECT 
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'transactions'
ORDER BY trigger_name;

-- 2️⃣ Ver las funciones relacionadas con transactions
SELECT 
  routine_name,
  routine_definition
FROM information_schema.routines
WHERE routine_name LIKE '%transaction%'
  OR routine_definition ILIKE '%payment_status%'
ORDER BY routine_name;

-- 3️⃣ SOLUCIÓN: Si el problema persiste, verificar y RE-APLICAR el fix
ALTER TABLE public.transactions 
ALTER COLUMN payment_status DROP DEFAULT;

ALTER TABLE public.transactions 
ALTER COLUMN payment_status SET DEFAULT NULL;

-- Verificar que se aplicó
SELECT 
  '✅ VERIFICACIÓN FINAL' as paso,
  column_name,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions' 
  AND column_name = 'payment_status';
