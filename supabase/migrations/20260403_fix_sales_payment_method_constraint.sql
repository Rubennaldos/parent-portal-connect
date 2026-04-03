-- ================================================================
-- FIX: sales_payment_method_check
-- Fecha: 2026-04-03
--
-- El constraint original de la tabla sales solo aceptaba un subset
-- de valores. El RPC complete_pos_sale_v2 genera valores como:
--   'yape_qr', 'yape_numero', 'plin_qr', 'plin_numero', 'mixto',
--   'saldo', 'debt', 'teacher_account', etc.
-- que no estaban incluidos → violation de constraint.
--
-- Solución:
--   1. Dropear el constraint antiguo (si existe).
--   2. Recrear con todos los valores posibles del sistema.
-- ================================================================

-- 1. Eliminar constraint antiguo
ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_payment_method_check;

-- 2. Recrear con todos los valores válidos del sistema
ALTER TABLE sales
  ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN (
    -- Español (valores del frontend)
    'efectivo',
    'tarjeta',
    'transferencia',
    'yape',
    'yape_qr',
    'yape_numero',
    'plin',
    'plin_qr',
    'plin_numero',
    'mixto',
    'otro',
    -- Inglés (valores normalizados del RPC)
    'cash',
    'card',
    'transfer',
    'mixed',
    -- Especiales del sistema
    'saldo',
    'debt',
    'credito',
    'teacher_account'
  ));

SELECT '✅ sales_payment_method_check recreado con todos los valores posibles' AS resultado;
