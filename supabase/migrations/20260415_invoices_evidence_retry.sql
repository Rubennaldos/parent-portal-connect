-- ============================================================================
-- MIGRACIÓN: Columna evidence_retry_count en invoices
-- Fecha: 2026-04-15
--
-- Propósito: Permite al poller (check-invoice-status) contar cuántas veces
-- intentó obtener las URLs de evidencia (PDF/XML/CDR) sin éxito.
-- Tras MAX_EVIDENCE_RETRIES intentos, el comprobante se marca accepted
-- con alerta crítica para revisión manual.
--
-- Sin esta columna el poller nunca puede saber si ya reintentó o no,
-- y puede quedar en bucle indefinido esperando URLs que nunca llegan.
-- ============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS evidence_retry_count SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.evidence_retry_count IS
  'Número de veces que el poller consultó a Nubefact y el comprobante '
  'apareció como aceptado por SUNAT pero sin URLs de PDF/XML/CDR. '
  'Al superar MAX_EVIDENCE_RETRIES (3) se marca accepted con alerta.';
