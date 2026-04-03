-- ============================================================================
-- Migration: Auto-billing nocturno (cron 10 PM Lima)
-- Agrega columna de toggle + tabla de logs para el sistema de facturación
-- automática de pagos digitales.
-- ============================================================================

-- 1. Toggle por sede en billing_config
ALTER TABLE billing_config
ADD COLUMN IF NOT EXISTS auto_billing_enabled BOOLEAN DEFAULT false;

-- 2. Tabla de logs para auditoría del cron
CREATE TABLE IF NOT EXISTS auto_billing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES schools(id),
  executed_at TIMESTAMPTZ DEFAULT now(),
  groups_processed INT DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  errors TEXT[] DEFAULT '{}',
  status TEXT CHECK (status IN ('success', 'partial', 'error')) NOT NULL DEFAULT 'success'
);

CREATE INDEX IF NOT EXISTS idx_auto_billing_logs_school
  ON auto_billing_logs(school_id, executed_at DESC);

-- 3. Campos para solicitud de comprobante desde portal de padres
ALTER TABLE recharge_requests
ADD COLUMN IF NOT EXISTS invoice_type TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS invoice_client_data JSONB DEFAULT NULL;

COMMENT ON COLUMN recharge_requests.invoice_type IS 'boleta | factura | NULL (sin preferencia → batch nocturno)';
COMMENT ON COLUMN recharge_requests.invoice_client_data IS 'JSON con doc_type, doc_number, razon_social, direccion, email del cliente para emitir comprobante';

-- ============================================================================
-- INSTRUCCIONES MANUALES PARA pg_cron (no ejecutar en migration)
-- ============================================================================
-- 1. Ir a Supabase Dashboard → Database → Extensions
-- 2. Buscar y habilitar "pg_cron"
-- 3. Buscar y habilitar "pg_net"
-- 4. Ejecutar en SQL Editor:
--
-- SELECT cron.schedule(
--   'auto-billing-nightly',
--   '0 3 * * *',  -- 3:00 AM UTC = 10:00 PM Lima
--   $$SELECT net.http_post(
--     url := 'https://duxqzozoahvrvqseinji.supabase.co/functions/v1/auto-billing',
--     headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
--     body := '{}'::jsonb
--   )$$
-- );
--
-- 5. Para verificar que el job existe:
--   SELECT * FROM cron.job;
--
-- 6. Para pausar el cron:
--   SELECT cron.unschedule('auto-billing-nightly');
-- ============================================================================
