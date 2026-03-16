-- Agregar medio de pago a ingresos/egresos manuales de caja
-- Necesario para que el cajero registre cómo ingresó el dinero
-- (efectivo, yape, plin, tarjeta, transferencia)

ALTER TABLE cash_manual_entries
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash','yape','plin','tarjeta','transferencia','otro'));

-- Índice para consultas por método de pago en cierre
CREATE INDEX IF NOT EXISTS idx_cash_manual_entries_payment_method
  ON cash_manual_entries(payment_method);

COMMENT ON COLUMN cash_manual_entries.payment_method IS
  'Medio por el que ingresó/salió el dinero: cash, yape, plin, tarjeta, transferencia, otro';
