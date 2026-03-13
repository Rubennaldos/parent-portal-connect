-- =====================================================================
-- FIX: Valentina Arellano Adrianzén — balance sucio
-- 
-- Situación: 
--   - 7 transacciones TODAS en payment_status = 'paid' ✅
--   - Suma total cobrada: S/ 93.50
--   - Pero students.balance = -93.50 (no se actualizó)
--
-- Causa: cuando se registró el cobro desde Cobranzas, las transacciones
-- se marcaron como 'paid' pero el campo balance del alumno quedó con
-- la deuda acumulada anterior.
--
-- Fix: actualizar el balance a 0 ya que no hay deudas pendientes.
-- =====================================================================

-- VERIFICAR antes de ejecutar: confirmar que no hay pendientes
SELECT 
  payment_status,
  COUNT(*) AS cantidad,
  SUM(ABS(amount)) AS total
FROM transactions
WHERE student_id = '1e4dc033-6227-4bf5-bcb9-93192b5cae5c'
  AND is_deleted = false
  AND type = 'purchase'
GROUP BY payment_status;

-- Si el resultado muestra SOLO 'paid' (sin pending ni partial),
-- ejecutar el siguiente UPDATE:

UPDATE students 
SET balance = 0
WHERE id = '1e4dc033-6227-4bf5-bcb9-93192b5cae5c'
  AND full_name = 'Valentina Arellano Adrianzén';

-- Confirmar el cambio
SELECT id, full_name, balance FROM students
WHERE id = '1e4dc033-6227-4bf5-bcb9-93192b5cae5c';
