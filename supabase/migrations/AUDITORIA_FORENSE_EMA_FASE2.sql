-- ================================================================
-- AUDITORÍA FORENSE — FASE 2 — Ema Noguerol
-- student_id: f9f2569a-7bd9-4609-b451-50e8bfbe45ef
-- Hipótesis: S/ 566.00 cargados directamente a students.balance
--            (sin pasar por transactions ni recharge_requests)
-- ================================================================

-- 1) Estructura de payment_transactions
--    (ver columnas disponibles antes de consultarla)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'payment_transactions'
ORDER BY ordinal_position;

-- 2) Estructura de billing_payments
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'billing_payments'
ORDER BY ordinal_position;

-- 3) Buscar a Ema en payment_transactions (todas las columnas)
SELECT *
FROM payment_transactions
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
   OR user_id    = '9ed4df4f-c85a-4cac-87a9-1fc7dc6e844b'  -- parent_id de Ema
ORDER BY created_at ASC;

-- 4) Buscar a Ema en billing_payments (todas las columnas)
SELECT *
FROM billing_payments
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
   OR user_id    = '9ed4df4f-c85a-4cac-87a9-1fc7dc6e844b'
ORDER BY created_at ASC;

-- 5) ¿Existe una columna student_id en payment_transactions?
--    Si no, buscar por cualquier columna que parezca un ID
SELECT *
FROM payment_transactions
LIMIT 5;

-- 6) ¿Existe una columna student_id en billing_payments?
SELECT *
FROM billing_payments
LIMIT 5;

-- 7) Confirmar matemática: ¿cuánto tendría que haber ingresado?
--    Resultado esperado: S/ 566.00 (= 246.50 + 319.50)
SELECT
  246.50 + 319.50 AS monto_origen_esperado,
  246.50          AS saldo_actual_en_bd,
  -319.50         AS suma_transacciones_registradas,
  'Si alguien metio 566 directamente a students.balance sin registrar en transactions, estos numeros cierran.' AS nota;
