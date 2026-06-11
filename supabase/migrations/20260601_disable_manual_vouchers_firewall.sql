-- ============================================================
-- TUQUI FIREWALL: Clausura definitiva de vouchers manuales
-- Fecha: 2026-06-01
-- Objetivo:
--   Bloquear INSERT de pagos manuales (Yape/Plin/Transferencia)
--   en recharge_requests para request_type recharge/debt_payment.
--
-- IMPORTANTE:
--   No toca IziPay, webhooks ni payment_sessions.
--   Solo endurece la tabla recharge_requests.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_manual_payments_disabled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(lower(trim(NEW.payment_method)), '') IN ('yape', 'plin', 'transferencia')
     AND COALESCE(lower(trim(NEW.request_type)), '') IN ('recharge', 'debt_payment') THEN
    RAISE EXCEPTION 'TUQUI_MANUAL_PAYMENTS_DISABLED: Los depósitos manuales con voucher han sido desactivados de forma permanente. Por favor, realice su pago utilizando tarjeta de crédito o débito a través de la pasarela oficial.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_manual_payments_disabled ON public.recharge_requests;

CREATE TRIGGER trg_ensure_manual_payments_disabled
BEFORE INSERT ON public.recharge_requests
FOR EACH ROW
EXECUTE FUNCTION public.ensure_manual_payments_disabled();

COMMENT ON FUNCTION public.ensure_manual_payments_disabled() IS
  'Bloquea vouchers manuales (yape/plin/transferencia) en recharge_requests para recharge/debt_payment.';
