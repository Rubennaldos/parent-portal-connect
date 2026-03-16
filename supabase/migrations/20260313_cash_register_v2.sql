-- =====================================================================
-- MÓDULO DE CIERRE DE CAJA v2 — Renovación Completa
-- 
-- Tablas nuevas:
--   1. cash_sessions           — Sesión diaria de caja (reemplaza flujo en cash_registers)
--   2. cash_manual_entries     — Ingresos y egresos manuales con categorías
--   3. cash_reconciliations    — Reconciliación final con conteo físico por método
--   4. treasury_transfers      — Cadena de custodia del efectivo hacia tesorería
--
-- NOTA: Las tablas existentes (cash_registers, cash_closures, cash_movements)
-- se mantienen intactas para no romper el histórico. El nuevo flujo usa las
-- tablas nuevas. La migración es 100% aditiva.
-- =====================================================================

-- ─── 1. SESIONES DE CAJA ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id),
  session_date    DATE NOT NULL,                          -- Fecha de la sesión (una por sede por día)
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed')),

  -- Apertura
  opened_by       UUID NOT NULL REFERENCES auth.users(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initial_cash    NUMERIC(10,2) NOT NULL DEFAULT 0,       -- Efectivo contado al abrir
  initial_yape    NUMERIC(10,2) NOT NULL DEFAULT 0,       -- Saldo digital Yape al abrir
  initial_plin    NUMERIC(10,2) NOT NULL DEFAULT 0,       -- Saldo digital Plin al abrir
  initial_other   NUMERIC(10,2) NOT NULL DEFAULT 0,       -- Otros saldos digitales al abrir

  -- Cierre (se llenan al cerrar)
  closed_by       UUID REFERENCES auth.users(id),
  closed_at       TIMESTAMPTZ,
  cashier_name    TEXT,                                    -- Nombre declarado del cajero
  cashier_dni     TEXT,                                    -- DNI del cajero
  cashier_signature TEXT,                                  -- Firma digital (base64 del canvas)
  closure_notes   TEXT,                                    -- Notas de cierre

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Una sola sesión abierta por sede por día
  CONSTRAINT uq_cash_session_school_date UNIQUE (school_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_school   ON cash_sessions (school_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_date     ON cash_sessions (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status   ON cash_sessions (status);

ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_sessions_select" ON cash_sessions FOR SELECT
  USING (true);

CREATE POLICY "cash_sessions_insert" ON cash_sessions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "cash_sessions_update" ON cash_sessions FOR UPDATE
  USING (auth.uid() IS NOT NULL);


-- ─── 2. INGRESOS / EGRESOS MANUALES ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cash_manual_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id  UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id),
  entry_type       TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  entry_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  category         TEXT NOT NULL CHECK (category IN (
    'overage',          -- Dinero sobrante
    'deficit',          -- Faltante detectado
    'internal_purchase',-- Compra interna (servilletas, etc.)
    'refund',           -- Devolución de dinero
    'miscellaneous'     -- Ingreso/egreso varios
  )),
  description      TEXT NOT NULL,
  created_by       UUID NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_manual_session ON cash_manual_entries (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_manual_school  ON cash_manual_entries (school_id);

ALTER TABLE cash_manual_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_manual_entries_select" ON cash_manual_entries FOR SELECT
  USING (true);

CREATE POLICY "cash_manual_entries_insert" ON cash_manual_entries FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─── 3. RECONCILIACIÓN FINAL (conteo físico por método) ─────────────────────

CREATE TABLE IF NOT EXISTS public.cash_reconciliations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id  UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id),

  -- Balance del sistema (calculado automáticamente al momento del cierre)
  system_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_tarjeta       NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_mixto         NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_total         NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Conteo físico del cajero
  physical_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_tarjeta       NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_mixto         NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_total         NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Varianza calculada (sistema - físico)
  variance_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_tarjeta       NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_mixto         NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_total         NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Campos del formato antiguo (Sobres, Revesa)
  declared_overage     NUMERIC(10,2) NOT NULL DEFAULT 0,  -- "SOBRES"
  declared_deficit     NUMERIC(10,2) NOT NULL DEFAULT 0,  -- "MONTO/REVESA S/"

  -- Metadatos
  reconciled_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_cash_reconciliation_session UNIQUE (cash_session_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_recon_session ON cash_reconciliations (cash_session_id);

ALTER TABLE cash_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_reconciliations_select" ON cash_reconciliations FOR SELECT
  USING (true);

CREATE POLICY "cash_reconciliations_insert" ON cash_reconciliations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─── 4. TRANSFERENCIAS A TESORERÍA (Cadena de Custodia) ─────────────────────

CREATE TABLE IF NOT EXISTS public.treasury_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id  UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id),

  -- Montos transferidos
  amount_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_total         NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Estado de la transferencia
  status           TEXT NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created', 'in_transit', 'received')),

  -- Firma del cajero que entrega
  sender_id        UUID NOT NULL REFERENCES auth.users(id),
  sender_name      TEXT NOT NULL,
  sender_signature TEXT,                                   -- base64

  -- Firma del receptor (tesorería / gerencia)
  receiver_id      UUID REFERENCES auth.users(id),
  receiver_name    TEXT,
  receiver_signature TEXT,                                 -- base64
  received_at      TIMESTAMPTZ,

  -- PDF inmutable generado
  pdf_url          TEXT,                                   -- URL en Supabase Storage

  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treasury_session ON treasury_transfers (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_treasury_school  ON treasury_transfers (school_id);
CREATE INDEX IF NOT EXISTS idx_treasury_status  ON treasury_transfers (status);

ALTER TABLE treasury_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treasury_transfers_select" ON treasury_transfers FOR SELECT
  USING (true);

CREATE POLICY "treasury_transfers_insert" ON treasury_transfers FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "treasury_transfers_update" ON treasury_transfers FOR UPDATE
  USING (auth.uid() IS NOT NULL);


-- ─── 5. TRIGGERS DE AUDITORÍA (conectar con audit_billing_logs de Fase 1) ──

DROP TRIGGER IF EXISTS trg_audit_cash_sessions ON cash_sessions;
CREATE TRIGGER trg_audit_cash_sessions
  AFTER INSERT OR UPDATE OR DELETE ON cash_sessions
  FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event();

DROP TRIGGER IF EXISTS trg_audit_cash_manual ON cash_manual_entries;
CREATE TRIGGER trg_audit_cash_manual
  AFTER INSERT OR UPDATE OR DELETE ON cash_manual_entries
  FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event();

DROP TRIGGER IF EXISTS trg_audit_treasury ON treasury_transfers;
CREATE TRIGGER trg_audit_treasury
  AFTER INSERT OR UPDATE OR DELETE ON treasury_transfers
  FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event();

DROP TRIGGER IF EXISTS trg_audit_cash_recon ON cash_reconciliations;
CREATE TRIGGER trg_audit_cash_recon
  AFTER INSERT OR UPDATE ON cash_reconciliations
  FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event();


-- ─── 6. FUNCIÓN AUXILIAR: Obtener sesión de caja abierta de hoy ────────────

CREATE OR REPLACE FUNCTION get_today_cash_session(p_school_id UUID)
RETURNS TABLE (
  id UUID,
  status TEXT,
  opened_at TIMESTAMPTZ,
  opened_by UUID,
  initial_cash NUMERIC,
  session_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id,
    cs.status,
    cs.opened_at,
    cs.opened_by,
    cs.initial_cash,
    cs.session_date
  FROM cash_sessions cs
  WHERE cs.school_id = p_school_id
    AND cs.session_date = CURRENT_DATE
  LIMIT 1;
END;
$$;


-- ─── 7. VERIFICACIÓN ────────────────────────────────────────────────────────

SELECT
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'cash_sessions',
    'cash_manual_entries',
    'cash_reconciliations',
    'treasury_transfers'
  )
ORDER BY table_name;
