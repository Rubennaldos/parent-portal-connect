-- ============================================================================
-- Invoicing Logs Pro Monitoring
-- Fecha: 2026-04-21
--
-- Objetivo:
--   1) Estandarizar la tabla invoicing_logs para trazabilidad completa.
--   2) Agregar columnas action/status para dashboard operativo.
--   3) Preparar índices para auditoría rápida por invoice/tiempo.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.invoicing_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  event_type       text NOT NULL,
  action           text NULL,
  status           text NULL,
  event_message    text NULL,
  request_payload  jsonb NULL,
  response_payload jsonb NULL,
  error_code       text NULL,
  error_message    text NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS action text NULL;

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS status text NULL;

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS request_payload jsonb NULL;

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS response_payload jsonb NULL;

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS event_message text NULL;

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS error_code text NULL;

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS error_message text NULL;

ALTER TABLE public.invoicing_logs
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_invoicing_logs_invoice_created
  ON public.invoicing_logs (invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoicing_logs_event_created
  ON public.invoicing_logs (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoicing_logs_action_status_created
  ON public.invoicing_logs (action, status, created_at DESC);

COMMENT ON TABLE public.invoicing_logs IS
  'Bitácora técnica de facturación electrónica. '
  'Incluye intentos de poller, payload request/response, errores y alertas críticas de retraso.';

