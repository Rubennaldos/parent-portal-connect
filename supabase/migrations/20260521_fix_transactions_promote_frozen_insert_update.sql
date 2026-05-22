-- ============================================================================
-- HOTFIX: Promocion de lunch_orders congelados en INSERT y UPDATE de tx paid
-- Fecha: 2026-05-21
--
-- Problema:
-- - El trigger previo solo corria en AFTER UPDATE OF payment_status.
-- - En ventas de caja con INSERT directo en payment_status='paid', el pedido
--   podia quedar frozen_pending_payment y no aparecer en entrega/pedidos.
--
-- Solucion aditiva:
-- - Mantener la misma funcion de promocion (fn_promote_frozen_order).
-- - Reemplazar el trigger de transactions a AFTER INSERT OR UPDATE.
-- - En UPDATE, conservar guard idempotente (solo cuando cambia a paid).
-- - En INSERT, promover inmediatamente si NEW.payment_status='paid' y metadata
--   trae lunch_order_id valido.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_fn_transactions_promote_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lunch_order_id UUID;
BEGIN
  -- Para UPDATE, solo actuar cuando el estado cambia a paid.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.payment_status IS NOT DISTINCT FROM 'paid' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Para INSERT o UPDATE, solo nos interesa paid.
  IF NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;

  -- Sin metadata/lunch_order_id no es transaccion de almuerzo.
  IF NEW.metadata IS NULL OR (NEW.metadata->>'lunch_order_id') IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_lunch_order_id := (NEW.metadata->>'lunch_order_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_fn_transactions_promote_frozen: metadata->lunch_order_id invalido. tx_id=%. Valor=%',
      NEW.id, NEW.metadata->>'lunch_order_id';
    RETURN NEW;
  END;

  PERFORM public.fn_promote_frozen_order(
    v_lunch_order_id,
    'transactions',
    NEW.id,
    NEW.school_id
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_fn_transactions_promote_frozen() IS
  'Trigger AFTER INSERT OR UPDATE en transactions. Promueve lunch_order frozen a confirmed_paid cuando NEW.payment_status=paid y metadata.lunch_order_id existe. UPDATE mantiene guard de cambio de estado.';

DROP TRIGGER IF EXISTS trg_transactions_promote_frozen ON public.transactions;

CREATE TRIGGER trg_transactions_promote_frozen
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_transactions_promote_frozen();

COMMENT ON TRIGGER trg_transactions_promote_frozen ON public.transactions IS
  'Fase 2 prepago (hotfix): promociona en INSERT paid y UPDATE->paid para evitar pedidos pagados invisibles.';

SELECT
  '20260521_fix_transactions_promote_frozen_insert_update ✅ listo' AS resultado;
