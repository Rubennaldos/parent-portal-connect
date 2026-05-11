-- ============================================================================
-- FASE 2 — MODO PREPAGO: TRIGGER DE PROMOCIÓN AUTOMÁTICA (Anti-Huérfanos)
-- Fecha: 2026-05-10
-- Ejecutar DESPUÉS de 20260510_d_prepayment_phase1_trigger.sql
--
-- Qué hace esta migración:
--   1. Crea fn_promote_frozen_order_on_payment()
--      Función compartida (idempotente) que promueve un pedido
--      de frozen_pending_payment → confirmed_paid, auditando
--      cualquier caso huérfano (pago sin pedido enlazado).
--
--   2. Crea trg_transactions_promote_frozen
--      AFTER UPDATE OF payment_status en public.transactions.
--      Se activa SOLO cuando payment_status cambia a 'paid'.
--      Busca el lunch_order_id en metadata y promueve el pedido.
--
--   3. Crea trg_recharge_requests_promote_frozen
--      AFTER UPDATE OF status en public.recharge_requests.
--      Se activa cuando status cambia a 'approved' y hay lunch_order_ids.
--      Promueve cada pedido en el array (soporte multi-voucher).
--
-- Principios aplicados (Reglas de Oro):
--   - Idempotencia estricta: doble 'paid' / doble 'approved' → sin efecto extra.
--   - El pago NUNCA se rechaza por reloj (este trigger es AFTER UPDATE, no INSERT).
--   - Huérfanos auditados en audit_billing_logs, no silenciados.
--   - Pedidos cancelados o en estado terminal NO se promueven.
--   - No se toca lógica de pasarela Izipay, HMAC, ni webhooks.
--   - No hay triggers de saldo: la promoción solo cambia payment_flow_state.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FUNCIÓN COMPARTIDA: fn_promote_frozen_order_on_payment
--    Llamada desde ambos triggers. Recibe un UUID de lunch_order
--    y lo promueve a confirmed_paid (idempotente, con audit).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_promote_frozen_order(
  p_lunch_order_id UUID,
  p_source_table   TEXT,       -- 'transactions' o 'recharge_requests'
  p_source_id      UUID,       -- id del registro que disparó el evento
  p_school_id      UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_rows INTEGER;
BEGIN
  -- ── Promover pedido si y solo si está congelado y no cancelado ─────────────
  UPDATE public.lunch_orders
     SET payment_flow_state = 'confirmed_paid'::public.lunch_order_payment_state
   WHERE id              = p_lunch_order_id
     AND payment_flow_state = 'frozen_pending_payment'::public.lunch_order_payment_state
     AND is_cancelled    = false;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  -- ── Auditar: si no se actualizó ninguna fila, registrar evento diagnóstico ─
  -- Caso A: el pedido ya estaba en confirmed_paid (idempotencia, no es error).
  -- Caso B: el pedido fue cancelado (no promover, no es error de sistema).
  -- Caso C: el UUID no existe en lunch_orders (huérfano real → audit_billing_logs).
  IF v_updated_rows = 0 THEN
    -- Verificar si el pedido existe para distinguir casos
    IF NOT EXISTS (
      SELECT 1 FROM public.lunch_orders WHERE id = p_lunch_order_id
    ) THEN
      -- Huérfano real: pago recibido pero no hay pedido con ese ID
      INSERT INTO public.audit_billing_logs (
        action_type,
        record_id,
        table_name,
        changed_by_user_id,
        school_id,
        new_data
      )
      VALUES (
        'ORPHAN_PAYMENT_NO_ORDER',
        p_source_id,
        p_source_table,
        NULL,
        p_school_id,
        jsonb_build_object(
          'lunch_order_id_referenced', p_lunch_order_id,
          'source_table',              p_source_table,
          'source_id',                 p_source_id,
          'ts_lima',                   timezone('America/Lima', now()),
          'nota',                      'Pago recibido pero lunch_order_id no existe en lunch_orders. Revisar.'
        )
      );

      RAISE WARNING 'fn_promote_frozen_order: HUÉRFANO — lunch_order_id=% no existe. Fuente: % id=%. Auditado.',
        p_lunch_order_id, p_source_table, p_source_id;
    END IF;
    -- Si el pedido existe pero no estaba frozen (ya paid o cancelado) → silencio intencional (idempotencia).
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    -- ── Fallback: loguear pero NO propagar excepción ──────────────────────────
    -- El pago ya fue registrado (este trigger es AFTER). No debemos revertir el pago
    -- por un fallo en la promoción de estado. Solo auditamos y alertamos.
    RAISE WARNING 'fn_promote_frozen_order: excepción inesperada (%). lunch_order_id=%, fuente=% id=%',
      SQLERRM, p_lunch_order_id, p_source_table, p_source_id;
END;
$$;

COMMENT ON FUNCTION public.fn_promote_frozen_order(UUID, TEXT, UUID, UUID) IS
  'Promueve un pedido de frozen_pending_payment a confirmed_paid. Idempotente. Audita huérfanos en audit_billing_logs. NO revierte pagos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FUNCIÓN DE TRIGGER: trg_fn_transactions_promote_frozen
--    Disparada AFTER UPDATE en transactions cuando payment_status → 'paid'.
--    Lee el lunch_order_id del campo metadata (jsonb).
--    No afecta transacciones sin almuerzo (kiosco, recargas, etc.).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_transactions_promote_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lunch_order_id UUID;
BEGIN
  -- ── Guard: solo actuar cuando payment_status cambia a 'paid' ───────────────
  -- OLD.payment_status IS DISTINCT FROM 'paid' evita re-disparos idempotentes.
  IF OLD.payment_status IS NOT DISTINCT FROM 'paid' THEN
    RETURN NEW;  -- ya estaba en 'paid': sin efecto
  END IF;

  IF NEW.payment_status <> 'paid' THEN
    RETURN NEW;  -- cambió a otro estado (pending, cancelled…): sin efecto
  END IF;

  -- ── Extraer lunch_order_id del metadata jsonb ─────────────────────────────
  -- Patrón establecido en el proyecto: metadata->>'lunch_order_id'
  IF NEW.metadata IS NULL OR (NEW.metadata->>'lunch_order_id') IS NULL THEN
    -- Sin almuerzo asociado (kiosco, recarga, etc.): sin acción
    RETURN NEW;
  END IF;

  BEGIN
    v_lunch_order_id := (NEW.metadata->>'lunch_order_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_fn_transactions_promote_frozen: metadata->lunch_order_id no es UUID válido. tx_id=%. Valor: %',
      NEW.id, NEW.metadata->>'lunch_order_id';
    RETURN NEW;
  END;

  -- ── Promover pedido (idempotente, con audit de huérfanos) ─────────────────
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
  'Trigger AFTER UPDATE en transactions. Cuando payment_status → paid, promueve el pedido frozen asociado. Idempotente. No afecta transacciones de kiosco o recarga.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRIGGER EN public.transactions
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_transactions_promote_frozen ON public.transactions;

CREATE TRIGGER trg_transactions_promote_frozen
  AFTER UPDATE OF payment_status
  ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_transactions_promote_frozen();

COMMENT ON TRIGGER trg_transactions_promote_frozen ON public.transactions IS
  'Fase 2 prepago: promueve pedido frozen → confirmed_paid cuando la transacción pasa a paid. Idempotente. No bloquea pagos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FUNCIÓN DE TRIGGER: trg_fn_recharge_requests_promote_frozen
--    Disparada AFTER UPDATE en recharge_requests cuando status → 'approved'.
--    Soporta arrays de lunch_order_ids (multi-voucher, multi-pedido).
--    NO toca la lógica de aprobación de vouchers ni de saldo (SSOT en fn_sync).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_recharge_requests_promote_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  -- ── Guard: solo cuando status cambia a 'approved' ─────────────────────────
  IF OLD.status IS NOT DISTINCT FROM 'approved' THEN
    RETURN NEW;  -- ya estaba aprobado: idempotencia
  END IF;

  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- ── Solo procesar si hay lunch_order_ids relacionados ────────────────────
  IF NEW.lunch_order_ids IS NULL OR cardinality(NEW.lunch_order_ids) = 0 THEN
    RETURN NEW;
  END IF;

  -- ── Iterar y promover cada pedido del array ───────────────────────────────
  FOREACH v_order_id IN ARRAY NEW.lunch_order_ids
  LOOP
    PERFORM public.fn_promote_frozen_order(
      v_order_id,
      'recharge_requests',
      NEW.id,
      NEW.school_id
    );
  END LOOP;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- Fallback: el pago ya fue aprobado, no lo revertimos.
    RAISE WARNING 'trg_fn_recharge_requests_promote_frozen: excepción (%). rr_id=%',
      SQLERRM, NEW.id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_fn_recharge_requests_promote_frozen() IS
  'Trigger AFTER UPDATE en recharge_requests. Cuando status → approved y hay lunch_order_ids, promueve cada pedido frozen. Soporte multi-voucher y multi-pedido.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TRIGGER EN public.recharge_requests
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_recharge_requests_promote_frozen ON public.recharge_requests;

CREATE TRIGGER trg_recharge_requests_promote_frozen
  AFTER UPDATE OF status
  ON public.recharge_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_recharge_requests_promote_frozen();

COMMENT ON TRIGGER trg_recharge_requests_promote_frozen ON public.recharge_requests IS
  'Fase 2 prepago: promueve pedidos frozen de un voucher aprobado. Idempotente. No altera lógica de saldo ni de aprobación existente.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. VERIFICACIÓN FINAL
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  tgname                   AS trigger_name,
  tgrelid::regclass        AS tabla,
  CASE tgtype & 66
    WHEN 2  THEN 'BEFORE'
    WHEN 64 THEN 'INSTEAD OF'
    ELSE         'AFTER'
  END                      AS timing,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 8  THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 20 THEN 'INSERT OR UPDATE'
    WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
    ELSE         'OTHER'
  END                      AS evento,
  tgenabled                AS habilitado
FROM   pg_trigger
WHERE  tgname IN (
  'trg_transactions_promote_frozen',
  'trg_recharge_requests_promote_frozen'
)
ORDER BY tgname;

SELECT
  '20260510_e_prepayment_phase2_promotion_trigger ✅ fn_promote_frozen_order + triggers en transactions y recharge_requests creados' AS resultado;
