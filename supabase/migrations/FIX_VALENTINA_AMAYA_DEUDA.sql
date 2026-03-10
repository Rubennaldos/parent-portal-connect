-- =========================================================
-- FIX: Liquidar deuda pendiente de Valentina Amaya (S/ 8.50)
-- =========================================================
-- Situación:
--   - Compra kiosco Mar 2 17:31 → S/ 8.50 quedó como deuda
--   - Recarga Mar 2 23:54 → S/ 25.00 acreditados (balance = 25)
--   - El padre reclamó que el saldo no bajó
--
-- Fix: Descontar los S/ 8.50 del saldo actual y marcar como pagado
-- =========================================================

-- PASO 1: Ver estado actual (confirmar antes de tocar)
SELECT
  s.full_name,
  s.balance     AS saldo_actual,
  s.free_account,
  t.id          AS transaction_id,
  t.ticket_code,
  t.amount,
  t.payment_status,
  t.description,
  t.created_at
FROM students s
INNER JOIN transactions t ON t.student_id = s.id
WHERE s.full_name ILIKE '%Valentina Amaya%'
  AND t.ticket_code = 'T-KLG-000247';

-- =========================================================
-- PASO 2: Aplicar el fix (ejecutar SOLO después de confirmar PASO 1)
-- =========================================================

-- 2A: Marcar la transacción como PAGADA (con saldo)
UPDATE transactions
SET
  payment_status = 'paid',
  payment_method = 'saldo',
  description    = 'Compra POS (Saldo) - S/ 8.50'
WHERE ticket_code = 'T-KLG-000247';

-- 2B: Descontar S/ 8.50 del saldo actual del estudiante
UPDATE students
SET balance = balance - 8.50
WHERE id = '3b770b6d-db49-44ea-9bf5-1c0ca3cd4819';  -- ID de Valentina

-- =========================================================
-- PASO 3: Confirmar que quedó correcto
-- =========================================================
SELECT
  s.full_name,
  s.balance             AS saldo_nuevo,   -- Debe ser 16.50
  s.free_account,
  t.ticket_code,
  t.payment_status,     -- Debe ser 'paid'
  t.payment_method      -- Debe ser 'saldo'
FROM students s
INNER JOIN transactions t ON t.student_id = s.id
WHERE s.id = '3b770b6d-db49-44ea-9bf5-1c0ca3cd4819'
  AND t.ticket_code = 'T-KLG-000247';
