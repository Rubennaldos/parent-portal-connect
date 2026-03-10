-- =========================================================
-- 🔧 FIX: Corregir saldo de estudiantes afectados por el bug
-- =========================================================
-- Bug: El POS no descontaba del saldo cuando free_account = true
-- Afectados: Maylén León Cuba y Catalina Lucía Alarcón Fudrini
-- =========================================================

-- ─── CASO 1: Maylén León Cuba ───────────────────────────────
-- Recargó: S/ 50
-- Compró en POS: S/ 8.50 (quedó como deuda 'pending' en vez de descontar)
-- Saldo actual: S/ 41.50 (INCORRECTO — debería reflejar el descuento)
-- 
-- Pero espera: 41.50 + 8.50 = 50, y el balance_after de la compra dice 0.00
-- Parece que el balance actual YA refleja la diferencia (50 - 8.50 = 41.50)
-- PERO la transacción está como 'pending' cuando debería ser 'paid'

-- PASO 1: Verificar estado actual de Maylén
SELECT 
  s.full_name,
  s.balance,
  s.free_account,
  t.id AS tx_id,
  t.amount,
  t.payment_status,
  t.description,
  t.created_at
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id 
  AND t.created_at >= '2026-03-01'
WHERE s.id = '476e8969-f2a9-4370-b977-83fba204d6e4'
ORDER BY t.created_at DESC;

-- PASO 2: Corregir la transacción de Maylén — cambiar de 'pending' a 'paid'
-- (ya que el saldo SÍ fue descontado en algún momento)
UPDATE transactions
SET 
  payment_status = 'paid',
  payment_method = 'saldo',
  description = REPLACE(description, '(Cuenta Libre)', '(Saldo Recarga)')
WHERE student_id = '476e8969-f2a9-4370-b977-83fba204d6e4'
  AND type = 'purchase'
  AND payment_status = 'pending'
  AND description LIKE '%Compra POS%'
  AND created_at >= '2026-03-01';

-- ─── CASO 2: Catalina Lucía Alarcón Fudrini ─────────────────
-- Recargó: S/ 200
-- Tiene almuerzos de S/ 16 c/u marcados como 'paid' 
-- Sus compras de almuerzo SÍ se descontaron (200 - 160 = 40)
-- NO tiene compras POS como deuda → no necesita corrección de POS
-- PERO verificamos su estado:

-- PASO 3: Verificar estado actual de Catalina
SELECT 
  s.full_name,
  s.balance,
  s.free_account,
  COUNT(CASE WHEN t.payment_status = 'pending' THEN 1 END) AS deudas_pendientes,
  SUM(CASE WHEN t.payment_status = 'pending' THEN ABS(t.amount) ELSE 0 END) AS total_deuda
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id AND t.type = 'purchase'
WHERE s.id = '7274e66a-a32e-4d29-9faf-b76ca6179a84'
GROUP BY s.id, s.full_name, s.balance, s.free_account;

-- ─── VERIFICACIÓN FINAL ──────────────────────────────────────
-- PASO 4: Confirmar que no quedan compras POS como deuda para estos estudiantes
SELECT 
  s.full_name,
  s.balance,
  t.payment_status,
  t.amount,
  t.description,
  t.created_at
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
WHERE s.id IN (
  '476e8969-f2a9-4370-b977-83fba204d6e4',
  '7274e66a-a32e-4d29-9faf-b76ca6179a84'
)
AND t.type = 'purchase'
AND t.payment_status = 'pending'
ORDER BY t.created_at DESC;
