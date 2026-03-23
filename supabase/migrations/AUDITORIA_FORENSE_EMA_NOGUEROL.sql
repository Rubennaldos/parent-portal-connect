-- ================================================================
-- AUDITORÍA FORENSE PROFUNDA — Ema Noguerol
-- student_id: f9f2569a-7bd9-4609-b451-50e8bfbe45ef
-- Objetivo: encontrar el origen del saldo S/ 246.50
-- ================================================================

-- 1) TODO el historial contable crudo (SIN filtrar por tipo ni status)
SELECT
  amount,
  type,
  payment_status,
  metadata,
  created_at
FROM transactions
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
ORDER BY created_at ASC;

-- 2) Suma por tipo — para ver el balance matemático de cada categoría
SELECT
  type,
  payment_status,
  COUNT(*)                        AS cantidad,
  ROUND(SUM(amount)::numeric, 2)  AS suma_total
FROM transactions
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
GROUP BY type, payment_status
ORDER BY type, payment_status;

-- 3) Órdenes de almuerzo de Ema (todas, incluyendo canceladas/reembolsadas)
SELECT
  id,
  status,
  order_date,
  total_amount,
  created_at
FROM lunch_orders
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
ORDER BY created_at ASC;

-- 4) recharge_requests de Ema SIN filtrar por request_type ni status
--    (por si hay registros de tipo distinto a 'recharge' que estemos ignorando)
SELECT
  id,
  amount,
  status,
  request_type,
  reference_code,
  created_at
FROM recharge_requests
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
ORDER BY created_at ASC;

-- 5) Tablas financieras existentes en el esquema público
--    (descubrir si hay tablas de depósitos, wallets, etc.)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name ILIKE '%pay%'
    OR table_name ILIKE '%recharge%'
    OR table_name ILIKE '%wallet%'
    OR table_name ILIKE '%deposit%'
    OR table_name ILIKE '%balance%'
    OR table_name ILIKE '%credit%'
    OR table_name ILIKE '%refund%'
    OR table_name ILIKE '%adjustment%'
  )
ORDER BY table_name;

-- 6) Verificación matemática directa
--    (balance_calculado debería coincidir con students.balance = 246.50)
SELECT
  ROUND(
    COALESCE(SUM(
      CASE WHEN payment_status = 'paid' OR payment_status IS NULL THEN amount ELSE 0 END
    )::numeric, 0)
  , 2) AS balance_calculado_todos_pagados,
  ROUND(SUM(amount)::numeric, 2)   AS balance_calculado_todo,
  (SELECT balance FROM students WHERE id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef') AS balance_real_en_bd
FROM transactions
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef';
