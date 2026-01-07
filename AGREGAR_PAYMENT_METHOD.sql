-- =====================================================
-- SCRIPT: AGREGAR PAYMENT_METHOD A TRANSACTIONS
-- Fecha: 2026-01-07
-- Descripción: Agregar columna para guardar método de pago
-- =====================================================

-- Agregar columna payment_method
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Crear índice
CREATE INDEX IF NOT EXISTS idx_transactions_payment_method 
ON transactions(payment_method);

-- Comentario explicativo
COMMENT ON COLUMN transactions.payment_method IS 
'Método de pago utilizado (yape, plin, tarjeta, efectivo, etc)';

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================

