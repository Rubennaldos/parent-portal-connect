-- =====================================================
-- VERIFICAR SI EXISTE operation_number EN TRANSACTIONS
-- =====================================================

-- 1️⃣ Ver la estructura de la columna operation_number
SELECT 
  '📋 COLUMNA operation_number' as tipo,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name LIKE '%operation%';

-- 2️⃣ Ver transacciones PAGADAS recientes con operation_number
SELECT 
  '💳 TRANSACCIONES CON NÚMERO DE OPERACIÓN' as tipo,
  id,
  description,
  amount,
  payment_method,
  operation_number,
  created_at
FROM transactions
WHERE payment_status = 'paid'
  AND payment_method IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- 3️⃣ Contar cuántas transacciones tienen operation_number
SELECT 
  '📊 RESUMEN operation_number' as tipo,
  COUNT(*) as total_pagadas,
  COUNT(operation_number) as con_numero_operacion,
  COUNT(*) - COUNT(operation_number) as sin_numero_operacion
FROM transactions
WHERE payment_status = 'paid';

-- 4️⃣ Ver la transacción específica del ejemplo (Claudia Esquerre, S/ 20.00)
SELECT 
  '🔍 TRANSACCIÓN ESPECÍFICA (S/ 20.00)' as tipo,
  id,
  description,
  amount,
  payment_method,
  operation_number,
  ticket_number,
  created_at,
  created_by
FROM transactions
WHERE payment_status = 'paid'
  AND amount = -20.00
  AND created_by = '97137d40-21e3-475e-829a-bad8554471d0'
ORDER BY created_at DESC
LIMIT 3;
