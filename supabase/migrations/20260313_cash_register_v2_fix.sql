-- =====================================================================
-- FIX v2: Módulo Cierre de Caja — 100% Idempotente
-- Usa DO $$ para eliminar políticas con manejo de errores,
-- evitando fallos si ya existen o si no existen.
-- =====================================================================

-- ─── PASO 1: Eliminar TODAS las políticas existentes de las 4 tablas ────────

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'cash_sessions',
        'cash_manual_entries',
        'cash_reconciliations',
        'treasury_transfers'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      pol.policyname, pol.tablename
    );
  END LOOP;
  RAISE NOTICE 'Politicas eliminadas correctamente.';
END;
$$;


-- ─── PASO 2: Crear tablas (IF NOT EXISTS) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id),
  session_date    DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed')),
  opened_by       UUID NOT NULL REFERENCES auth.users(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initial_cash    NUMERIC(10,2) NOT NULL DEFAULT 0,
  initial_yape    NUMERIC(10,2) NOT NULL DEFAULT 0,
  initial_plin    NUMERIC(10,2) NOT NULL DEFAULT 0,
  initial_other   NUMERIC(10,2) NOT NULL DEFAULT 0,
  closed_by       UUID REFERENCES auth.users(id),
  closed_at       TIMESTAMPTZ,
  cashier_name    TEXT,
  cashier_dni     TEXT,
  cashier_signature TEXT,
  closure_notes   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cash_session_school_date UNIQUE (school_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_school  ON cash_sessions (school_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_date    ON cash_sessions (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status  ON cash_sessions (status);

CREATE TABLE IF NOT EXISTS public.cash_manual_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id  UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id),
  entry_type       TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  entry_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  category         TEXT NOT NULL CHECK (category IN (
    'overage', 'deficit', 'internal_purchase', 'refund', 'miscellaneous'
  )),
  description      TEXT NOT NULL,
  created_by       UUID NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_manual_session ON cash_manual_entries (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_manual_school  ON cash_manual_entries (school_id);

CREATE TABLE IF NOT EXISTS public.cash_reconciliations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id  UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id),
  system_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_tarjeta       NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_mixto         NUMERIC(10,2) NOT NULL DEFAULT 0,
  system_total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_tarjeta       NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_mixto         NUMERIC(10,2) NOT NULL DEFAULT 0,
  physical_total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_tarjeta       NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_mixto         NUMERIC(10,2) NOT NULL DEFAULT 0,
  variance_total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  declared_overage     NUMERIC(10,2) NOT NULL DEFAULT 0,
  declared_deficit     NUMERIC(10,2) NOT NULL DEFAULT 0,
  reconciled_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cash_reconciliation_session UNIQUE (cash_session_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_recon_session ON cash_reconciliations (cash_session_id);

CREATE TABLE IF NOT EXISTS public.treasury_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id  UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id),
  amount_cash          NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_yape          NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_plin          NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_transferencia NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created', 'in_transit', 'received')),
  sender_id        UUID NOT NULL REFERENCES auth.users(id),
  sender_name      TEXT NOT NULL,
  sender_signature TEXT,
  receiver_id      UUID REFERENCES auth.users(id),
  receiver_name    TEXT,
  receiver_signature TEXT,
  received_at      TIMESTAMPTZ,
  pdf_url          TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treasury_session ON treasury_transfers (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_treasury_school  ON treasury_transfers (school_id);
CREATE INDEX IF NOT EXISTS idx_treasury_status  ON treasury_transfers (status);


-- ─── PASO 3: Habilitar RLS ───────────────────────────────────────────────────

ALTER TABLE cash_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_manual_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_reconciliations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_transfers    ENABLE ROW LEVEL SECURITY;


-- ─── PASO 4: Crear políticas (ahora seguro porque las eliminamos en el DO $$) ─

CREATE POLICY "cash_sessions_select" ON cash_sessions FOR SELECT USING (true);
CREATE POLICY "cash_sessions_insert" ON cash_sessions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cash_sessions_update" ON cash_sessions FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "cash_manual_entries_select" ON cash_manual_entries FOR SELECT USING (true);
CREATE POLICY "cash_manual_entries_insert" ON cash_manual_entries FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "cash_reconciliations_select" ON cash_reconciliations FOR SELECT USING (true);
CREATE POLICY "cash_reconciliations_insert" ON cash_reconciliations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "treasury_transfers_select" ON treasury_transfers FOR SELECT USING (true);
CREATE POLICY "treasury_transfers_insert" ON treasury_transfers FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "treasury_transfers_update" ON treasury_transfers FOR UPDATE USING (auth.uid() IS NOT NULL);


-- ─── PASO 5: Triggers de auditoría (solo si existe la función) ──────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'log_billing_audit_event') THEN

    DROP TRIGGER IF EXISTS trg_audit_cash_sessions    ON cash_sessions;
    DROP TRIGGER IF EXISTS trg_audit_cash_manual      ON cash_manual_entries;
    DROP TRIGGER IF EXISTS trg_audit_treasury         ON treasury_transfers;
    DROP TRIGGER IF EXISTS trg_audit_cash_recon       ON cash_reconciliations;

    EXECUTE 'CREATE TRIGGER trg_audit_cash_sessions
      AFTER INSERT OR UPDATE OR DELETE ON cash_sessions
      FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event()';

    EXECUTE 'CREATE TRIGGER trg_audit_cash_manual
      AFTER INSERT OR UPDATE OR DELETE ON cash_manual_entries
      FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event()';

    EXECUTE 'CREATE TRIGGER trg_audit_treasury
      AFTER INSERT OR UPDATE OR DELETE ON treasury_transfers
      FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event()';

    EXECUTE 'CREATE TRIGGER trg_audit_cash_recon
      AFTER INSERT OR UPDATE ON cash_reconciliations
      FOR EACH ROW EXECUTE FUNCTION log_billing_audit_event()';

    RAISE NOTICE 'Triggers de auditoria creados.';
  ELSE
    RAISE NOTICE 'Funcion log_billing_audit_event no encontrada — triggers omitidos.';
  END IF;
END;
$$;


-- ─── PASO 6: Función auxiliar ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_today_cash_session(p_school_id UUID)
RETURNS TABLE (
  id UUID, status TEXT, opened_at TIMESTAMPTZ,
  opened_by UUID, initial_cash NUMERIC, session_date DATE
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT cs.id, cs.status, cs.opened_at, cs.opened_by, cs.initial_cash, cs.session_date
  FROM cash_sessions cs
  WHERE cs.school_id = p_school_id AND cs.session_date = CURRENT_DATE
  LIMIT 1;
END;
$$;


-- ─── VERIFICACIÓN ────────────────────────────────────────────────────────────

SELECT
  t.table_name,
  COUNT(p.policyname) AS num_policies
FROM information_schema.tables t
LEFT JOIN pg_policies p
  ON p.tablename = t.table_name AND p.schemaname = 'public'
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'cash_sessions', 'cash_manual_entries',
    'cash_reconciliations', 'treasury_transfers'
  )
GROUP BY t.table_name
ORDER BY t.table_name;
