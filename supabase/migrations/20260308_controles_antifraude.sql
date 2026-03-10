-- ============================================================
-- CONTROLES ANTI-FRAUDE — 8 de marzo 2026
-- ============================================================
-- Mejora 2: Tabla de alertas de anulación
-- Mejora 5: Columna created_by NOT NULL (con fix de existentes)
-- ============================================================

-- ===========================
-- TABLA: cancellation_alerts
-- ===========================
CREATE TABLE IF NOT EXISTS cancellation_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  transaction_id UUID,
  lunch_order_id UUID,
  alert_type TEXT NOT NULL DEFAULT 'sale_cancelled',
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  refund_method TEXT,
  cancelled_by UUID,
  cancellation_reason TEXT,
  client_name TEXT,
  ticket_code TEXT,
  is_read BOOLEAN DEFAULT false,
  read_by UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cancellation_alerts_school
  ON cancellation_alerts(school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cancellation_alerts_unread
  ON cancellation_alerts(school_id, is_read) WHERE is_read = false;

ALTER TABLE cancellation_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cancellation_alerts_select" ON cancellation_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role = 'admin_general'
        OR profiles.school_id = cancellation_alerts.school_id
      )
    )
  );

CREATE POLICY "cancellation_alerts_insert" ON cancellation_alerts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
    )
  );

CREATE POLICY "cancellation_alerts_update" ON cancellation_alerts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role = 'admin_general'
        OR profiles.school_id = cancellation_alerts.school_id
      )
    )
  );
