-- ============================================================
-- MIGRACIÓN: Columnas de facturación en transactions y profiles
-- ============================================================

-- ── Tabla: transactions ──────────────────────────────────────

-- is_taxable: false = Efectivo + Ticket (excluido de facturación electrónica)
--             true  = cualquier otro caso (boleta, factura, pago digital)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT true;

-- billing_status: estado de la facturación electrónica de esta transacción
--   'pending'  = pendiente de emitir (digital no-ticket, o boleta/factura no emitida aún)
--   'sent'     = comprobante emitido correctamente en Nubefact
--   'excluded' = excluido explícitamente (Efectivo + Ticket)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (billing_status IN ('pending', 'sent', 'excluded'));

-- Retroactivo: las transacciones antiguas que ya tienen invoice_id → marcadas como 'sent'
UPDATE public.transactions
  SET billing_status = 'sent'
  WHERE invoice_id IS NOT NULL AND billing_status = 'pending';

-- Retroactivo: las de tipo 'ticket' con payment_method 'cash' → excluidas
UPDATE public.transactions
  SET is_taxable = false, billing_status = 'excluded'
  WHERE (document_type = 'ticket' OR document_type IS NULL)
    AND (payment_method IN ('cash', 'efectivo') OR payment_method IS NULL)
    AND invoice_id IS NULL
    AND billing_status = 'pending';

-- Índice útil para consultas de facturación pendiente
CREATE INDEX IF NOT EXISTS idx_transactions_billing_status
  ON public.transactions (billing_status, school_id)
  WHERE billing_status = 'pending';

-- ── Tabla: profiles (datos fiscales del padre) ───────────────

-- RUC guardado para auto-rellenar en próximas facturas
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_ruc TEXT;

-- Razón Social guardada
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_razon_social TEXT;

-- Dirección fiscal guardada
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_direccion_fiscal TEXT;

-- Email fiscal guardado (para envío automático de PDF)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_email_fiscal TEXT;

-- Tipo de comprobante preferido del padre
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_invoice_type TEXT DEFAULT 'boleta'
  CHECK (preferred_invoice_type IN ('boleta', 'factura'));

-- ── Mensaje de confirmación ──────────────────────────────────
SELECT
  '✅ Migración 20260331_billing_columns aplicada correctamente' AS status,
  (SELECT COUNT(*) FROM public.transactions WHERE billing_status = 'sent')  AS tx_sent,
  (SELECT COUNT(*) FROM public.transactions WHERE billing_status = 'excluded') AS tx_excluded,
  (SELECT COUNT(*) FROM public.transactions WHERE billing_status = 'pending')  AS tx_pending;
