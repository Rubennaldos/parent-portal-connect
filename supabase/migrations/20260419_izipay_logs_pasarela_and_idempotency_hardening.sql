-- =============================================================================
-- ARQUISIA: Blindaje de Producción IziPay
-- Fecha: 2026-04-19
-- Objetivo:
--   1) Trazabilidad bancaria de pasarela (logs_pasarela)
--   2) Idempotencia reforzada por referencia de gateway
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.logs_pasarela (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name          text NOT NULL CHECK (provider_name IN ('izipay','niubiz','culqi','mercadopago','stripe')),
  gateway_reference_id   text NOT NULL,
  gateway_transaction_id text,
  payment_transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  webhook_event_id       uuid REFERENCES public.gateway_webhook_events(id) ON DELETE SET NULL,
  event_type             text NOT NULL DEFAULT 'webhook',
  status                 text NOT NULL DEFAULT 'received' CHECK (status IN ('received','applied','rejected','idempotent','error')),
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message          text,
  processed_at           timestamptz,
  attempt_count          integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_pasarela_provider_ref_unique
  ON public.logs_pasarela(provider_name, gateway_reference_id);

CREATE INDEX IF NOT EXISTS idx_logs_pasarela_gateway_tx
  ON public.logs_pasarela(gateway_transaction_id)
  WHERE gateway_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_pasarela_status_created
  ON public.logs_pasarela(status, created_at DESC);

CREATE OR REPLACE FUNCTION public.trg_logs_pasarela_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_logs_pasarela_set_updated_at ON public.logs_pasarela;
CREATE TRIGGER trg_logs_pasarela_set_updated_at
BEFORE UPDATE ON public.logs_pasarela
FOR EACH ROW
EXECUTE FUNCTION public.trg_logs_pasarela_set_updated_at();

ALTER TABLE public.logs_pasarela ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_logs_pasarela" ON public.logs_pasarela;
CREATE POLICY "service_role_full_access_logs_pasarela"
  ON public.logs_pasarela
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "no_public_access_logs_pasarela" ON public.logs_pasarela;
CREATE POLICY "no_public_access_logs_pasarela"
  ON public.logs_pasarela
  FOR SELECT
  TO authenticated
  USING (false);

COMMENT ON TABLE public.logs_pasarela IS
'Bitácora bancaria de eventos de pasarela. Guarda transaction_id del proveedor y estado de procesamiento para auditoría e idempotencia.';
