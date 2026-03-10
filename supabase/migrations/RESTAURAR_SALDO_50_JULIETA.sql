-- ═══════════════════════════════════════════════
-- RESTAURAR SALDO A 50 SOLES: Julieta Neyra Lamas
-- ═══════════════════════════════════════════════

-- RESUMEN:
-- ✅ Recarga: 50.00 soles
-- ❌ Consumido: 13.50 soles (compra POS del 3 de marzo)
-- ❌ Saldo actual: 39.00 (debería ser 36.50, pero tiene 2.50 de más)
-- 🎯 Saldo objetivo: 50.00 soles (como si no hubiera consumido nada)

-- PASO 1: Cancelar la transacción de compra (marcarla como cancelled)
UPDATE transactions
SET payment_status = 'cancelled',
    metadata = COALESCE(metadata, '{}'::jsonb) || 
               jsonb_build_object(
                 'cancelled_reason', 'Restauración de saldo - Cancelación de consumo',
                 'cancelled_at', NOW()::text,
                 'cancelled_by', 'admin_restore'
               )
WHERE id = 'b523b599-4b3e-4408-92e9-44ae09aeb7ab'
  AND student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND payment_status = 'paid';

-- PASO 2: Restaurar el saldo a 50.00 soles
UPDATE students
SET balance = 50.00
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- PASO 3: Verificar saldo después de restaurar
SELECT 
  id,
  full_name,
  balance AS saldo_restaurado,
  'Debería ser: 50.00' AS saldo_esperado,
  CASE 
    WHEN balance = 50.00 THEN '✅ CORRECTO - Saldo restaurado a 50.00'
    ELSE '❌ Aún incorrecto'
  END AS estado
FROM students
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- PASO 4: Verificar que la transacción esté cancelada
SELECT 
  id,
  description,
  ABS(amount) AS monto,
  payment_status,
  metadata->>'cancelled_reason' AS motivo_cancelacion
FROM transactions
WHERE id = 'b523b599-4b3e-4408-92e9-44ae09aeb7ab';
