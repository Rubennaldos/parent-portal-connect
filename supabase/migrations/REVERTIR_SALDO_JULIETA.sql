-- ═══════════════════════════════════════════════
-- REVERTIR SALDO: Julieta Neyra Lamas
-- ═══════════════════════════════════════════════

-- PROBLEMA: Se sumó 2.50 soles por error cuando el saldo ya estaba correcto
-- Saldo actual: 39.00 (incorrecto)
-- Saldo correcto: 36.50 (50 de recarga - 13.50 de compra POS)

-- REVERTIR: Restar los 2.50 que se sumaron por error
UPDATE students
SET balance = balance - 2.50
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- VERIFICAR saldo después de revertir
SELECT 
  id,
  full_name,
  balance AS saldo_corregido,
  'Debería ser: 36.50' AS saldo_esperado,
  CASE 
    WHEN balance = 36.50 THEN '✅ CORRECTO'
    ELSE '❌ Aún incorrecto'
  END AS estado
FROM students
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- EXPLICACIÓN:
-- ✅ Recarga: 50.00 soles
-- ✅ Compra POS: -13.50 soles
-- ✅ Saldo correcto: 50.00 - 13.50 = 36.50 soles
-- ❌ El UPDATE anterior sumó 2.50 por error (pensando que faltaba)
-- ✅ Ahora se revierte para volver a 36.50
