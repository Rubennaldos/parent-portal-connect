-- ============================================================
-- Sistema de Recargas Manuales con Voucher
-- Padres envían comprobante → Admin aprueba → Saldo recargado
-- ============================================================

CREATE TABLE IF NOT EXISTS recharge_requests (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id      UUID REFERENCES students(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES profiles(id),
  school_id       UUID REFERENCES schools(id),
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL,     -- 'yape', 'plin', 'transferencia', 'efectivo'
  reference_code  TEXT,              -- número de operación Yape/Plin/banco
  voucher_url     TEXT,              -- URL imagen del comprobante (Supabase Storage)
  notes           TEXT,              -- nota opcional del padre
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  transaction_id  UUID REFERENCES transactions(id), -- transacción creada al aprobar
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_recharge_requests_school    ON recharge_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_recharge_requests_status    ON recharge_requests(status);
CREATE INDEX IF NOT EXISTS idx_recharge_requests_student   ON recharge_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_recharge_requests_parent    ON recharge_requests(parent_id);

-- RLS
ALTER TABLE recharge_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recharge_requests_all" ON recharge_requests;
CREATE POLICY "recharge_requests_all" ON recharge_requests FOR ALL USING (true);

-- Bucket de storage para vouchers (ejecutar en Supabase Dashboard → Storage)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('vouchers', 'vouchers', false)
-- ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
SELECT 'recharge_requests creada OK' as resultado;
