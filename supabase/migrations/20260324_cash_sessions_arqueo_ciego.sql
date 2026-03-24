-- ============================================================
-- Arqueo Ciego: agregar columnas de monto declarado, diferencia
-- y justificación en cash_sessions + cash_reconciliations
-- ============================================================

ALTER TABLE cash_sessions
  ADD COLUMN IF NOT EXISTS declared_cash      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS declared_tarjeta   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS system_cash        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS system_tarjeta     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS variance_cash      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS variance_tarjeta   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS variance_total     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS variance_justification TEXT;
