-- ============================================================================
-- Migration: Hardening del sistema de facturación automática
-- Agrega billing_processing_at para TTL anti-zombie (Fix 1)
-- y filtra transacciones negativas del cierre mensual (Fix 4)
-- ============================================================================

-- 1. Timestamp que registra CUÁNDO una transacción entró en estado 'processing'.
--    Si lleva más de 30 minutos en 'processing', el sistema la regresa a 'pending'.
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS billing_processing_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN transactions.billing_processing_at IS
  'Timestamp de cuando se marcó billing_status=processing. '
  'Si lleva >30 min, auto-billing la regresa a pending (TTL anti-zombie).';

-- Índice parcial para que la consulta de TTL sea rápida (solo filas processing)
CREATE INDEX IF NOT EXISTS idx_transactions_billing_processing_at
  ON transactions(school_id, billing_processing_at)
  WHERE billing_status = 'processing';

-- 2. Tabla de alertas para transacciones negativas detectadas por el cierre
CREATE TABLE IF NOT EXISTS billing_negative_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID REFERENCES schools(id),
  detected_at  TIMESTAMPTZ DEFAULT now(),
  tx_ids       TEXT[] NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  status       TEXT CHECK (status IN ('pending_review', 'resolved')) DEFAULT 'pending_review',
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_negative_alerts_school
  ON billing_negative_alerts(school_id, detected_at DESC);

COMMENT ON TABLE billing_negative_alerts IS
  'Registro de transacciones con amount < 0 detectadas durante el Cierre Mensual. '
  'Deben resolverse con una Nota de Crédito en lugar de una boleta.';
