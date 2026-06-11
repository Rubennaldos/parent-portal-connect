-- ============================================================================
-- MIGRACION: Blindaje de cancelacion de almuerzos (cascada contable)
-- Fecha: 2026-05-22
--
-- OBJETIVO:
--   1) Cuando un lunch_order pasa a cancelado, cancelar automaticamente en BD
--      las transacciones pendientes vinculadas por metadata.lunch_order_id.
--   2) Reparar huerfanos historicos (pedido cancelado + deuda pending).
--
-- REGLAS:
--   - Solo tocar transacciones con payment_status = 'pending'
--   - Nunca tocar transacciones enviadas a SUNAT (billing_status = 'sent')
--   - Todo se ejecuta del lado servidor (sin depender del frontend)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_handle_lunch_order_cancellation_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo actuar cuando el pedido cruza de no-cancelado -> cancelado.
  IF
    (COALESCE(NEW.is_cancelled, false) = true OR NEW.status = 'cancelled')
    AND COALESCE(OLD.is_cancelled, false) = false
  THEN
    UPDATE public.transactions t
    SET
      payment_status = 'cancelled',
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'cancelled_at', to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'cancelled_by', COALESCE(NEW.cancelled_by::text, OLD.cancelled_by::text, 'system_trigger'),
        'cancel_reason', COALESCE(NEW.cancellation_reason, 'Cascade cancel desde lunch_orders')
      )
    WHERE t.is_deleted = false
      AND t.type = 'purchase'
      AND t.payment_status = 'pending'
      AND COALESCE(t.billing_status, 'pending') <> 'sent'
      AND t.metadata->>'lunch_order_id' = NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lunch_order_cancellation_cascade ON public.lunch_orders;

CREATE TRIGGER trg_lunch_order_cancellation_cascade
AFTER UPDATE ON public.lunch_orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_handle_lunch_order_cancellation_cascade();

COMMENT ON FUNCTION public.fn_handle_lunch_order_cancellation_cascade IS
  'Cancela en cascada transacciones pending vinculadas a lunch_orders cancelados. Respeta SUNAT (billing_status=sent).';

COMMENT ON TRIGGER trg_lunch_order_cancellation_cascade ON public.lunch_orders IS
  'Al cancelar un lunch_order, fuerza payment_status=cancelled en transacciones pending vinculadas.';

-- ============================================================================
-- ONE-SHOT: Reparacion de huerfanos historicos
-- ============================================================================
UPDATE public.transactions t
SET
  payment_status = 'cancelled',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'cancelled_at', to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'cancelled_by', 'migration_20260522_cascade_order_cancellation_trigger',
    'cancel_reason', 'DATA_REPAIR: lunch_order cancelado pero transaccion seguia pending'
  )
FROM public.lunch_orders lo
WHERE t.is_deleted = false
  AND t.type = 'purchase'
  AND t.payment_status = 'pending'
  AND COALESCE(t.billing_status, 'pending') <> 'sent'
  AND t.metadata ? 'lunch_order_id'
  AND t.metadata->>'lunch_order_id' = lo.id::text
  AND (COALESCE(lo.is_cancelled, false) = true OR lo.status = 'cancelled');

NOTIFY pgrst, 'reload schema';

SELECT 'OK: trigger de cascada + reparacion de huerfanos aplicado' AS resultado;
