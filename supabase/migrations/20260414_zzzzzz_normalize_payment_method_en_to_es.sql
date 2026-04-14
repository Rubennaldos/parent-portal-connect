-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: normalize_payment_method_en_to_es
-- Fecha    : 2026-04-14
--
-- PROBLEMA:
--   La tabla `transactions` tiene una mezcla de valores en inglés y español
--   para el campo payment_method. El POS en algún momento guardó 'cash' y
--   'card' (inglés), y las rutas más recientes guardan 'efectivo' y 'tarjeta'.
--   Esto hace que los reportes de arqueo muestren "Cash" y "Efectivo" como
--   dos categorías distintas en lugar de una sola.
--
-- ALCANCE:
--   Solo afecta la tabla `transactions`. No tocamos `sales` porque
--   Finanzas.tsx la filtra explícitamente por 'cash'/'card'.
--
-- VALORES NORMALIZADOS:
--   'cash'        → 'efectivo'
--   'card'        → 'tarjeta'
--   'transfer'    → 'transferencia'
--   'yape_qr'     → 'yape'
--   'yape_numero' → 'yape'
--   'plin_qr'     → 'plin'
--   'plin_numero' → 'plin'
--
-- SEGURIDAD: BEGIN/COMMIT explícitos. Si algo falla, se hace ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── VERIFICACIÓN PREVIA (cuántos registros se van a tocar) ────────────────
SELECT
  payment_method,
  COUNT(*) AS cantidad
FROM transactions
WHERE payment_method IN ('cash','card','transfer','yape_qr','yape_numero','plin_qr','plin_numero')
  AND is_deleted = false
GROUP BY payment_method
ORDER BY cantidad DESC;

-- ── NORMALIZACIÓN ─────────────────────────────────────────────────────────
BEGIN;

UPDATE transactions
SET payment_method = 'efectivo'
WHERE payment_method = 'cash'
  AND is_deleted = false;

UPDATE transactions
SET payment_method = 'tarjeta'
WHERE payment_method IN ('card', 'visa', 'mastercard', 'debit')
  AND is_deleted = false;

UPDATE transactions
SET payment_method = 'transferencia'
WHERE payment_method = 'transfer'
  AND is_deleted = false;

UPDATE transactions
SET payment_method = 'yape'
WHERE payment_method IN ('yape_qr', 'yape_numero')
  AND is_deleted = false;

UPDATE transactions
SET payment_method = 'plin'
WHERE payment_method IN ('plin_qr', 'plin_numero')
  AND is_deleted = false;

COMMIT;

-- ── VERIFICACIÓN FINAL ────────────────────────────────────────────────────
SELECT
  payment_method,
  COUNT(*) AS cantidad
FROM transactions
WHERE is_deleted = false
  AND payment_method IS NOT NULL
GROUP BY payment_method
ORDER BY cantidad DESC;

SELECT '✅ Normalización de payment_method completada.' AS status;
