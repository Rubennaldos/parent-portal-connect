-- ════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: cancel_lunch_order — versión 2 con guards en servidor
-- Fecha: 2026-04-16
--
-- Cambios respecto a v1 (20260403_cancel_lunch_order_rpc.sql):
--
--  1. GUARD DE ROL (servidor):
--     Solo admin_sede, admin_general y superadmin pueden anular pedidos.
--     Si otro rol llama directamente a la API/RPC, recibe error 'FORBIDDEN_ROLE'.
--
--  2. GUARD DE HORA DE CORTE (servidor):
--     Verifica la hora actual (America/Lima) contra lunch_configuration.cancellation_deadline_time
--     de la sede del pedido. Retorna error 'AFTER_CUTOFF' si ya pasó.
--     Default: 09:00 si la sede no tiene configuración.
--
--  3. ANTI RACE-CONDITION (FOR UPDATE):
--     El SELECT del pedido usa FOR UPDATE para bloquear la fila.
--     Si dos admins intentan anular simultáneamente:
--       - El primero adquiere el lock y completa la anulación.
--       - El segundo espera, luego lee is_cancelled = true → retorna 'ALREADY_CANCELLED'.
--     Garantiza idempotencia: el saldo/transacción no se toca dos veces.
--
--  4. Parámetro p_reason ahora opcional (default descriptivo por rol).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cancel_lunch_order(
  p_order_id     UUID,
  p_cancelled_by UUID,
  p_reason       TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role       TEXT;
  v_order_school_id   UUID;
  v_deadline_time     TIME;
  v_lima_time         TIME;
  v_tx_id             UUID;
  v_tx_payment_status TEXT;
  v_tx_billing_status TEXT;
  v_tx_cancelled      BOOLEAN := false;
  v_already_billed    BOOLEAN := false;
  v_effective_reason  TEXT;
BEGIN

  -- ── Guard 1: Verificar que el solicitante tiene rol autorizado ───────────
  SELECT role INTO v_caller_role
  FROM profiles
  WHERE id = p_cancelled_by;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin_sede', 'admin_general', 'superadmin') THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'No tienes permiso para anular pedidos de almuerzo.',
      'error_code', 'FORBIDDEN_ROLE'
    );
  END IF;

  -- ── Guard 2: Verificar hora de corte (hora Lima actual vs configuración) ─
  -- Obtener la sede del pedido
  SELECT school_id INTO v_order_school_id
  FROM lunch_orders
  WHERE id = p_order_id;

  -- Buscar la hora de corte configurada para la sede
  SELECT cancellation_deadline_time INTO v_deadline_time
  FROM lunch_configuration
  WHERE school_id = v_order_school_id
  LIMIT 1;

  -- Si no hay configuración, usar 09:00 como default
  v_deadline_time := COALESCE(v_deadline_time, '09:00:00'::TIME);

  -- Hora actual en Lima
  v_lima_time := (NOW() AT TIME ZONE 'America/Lima')::TIME;

  IF v_lima_time >= v_deadline_time THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'La hora de corte ya pasó. Solo se pueden anular pedidos antes de las '
                    || TO_CHAR(v_deadline_time, 'HH12:MI AM') || '.',
      'error_code', 'AFTER_CUTOFF',
      'deadline',   TO_CHAR(v_deadline_time, 'HH12:MI AM')
    );
  END IF;

  -- ── Guard 3: Bloqueo de fila (FOR UPDATE → previene race condition) ──────
  -- Si dos admins llegan al mismo tiempo:
  --   • El primero adquiere el lock.
  --   • El segundo espera; cuando el primero termina, lee is_cancelled=true → retorna ALREADY_CANCELLED.
  PERFORM 1
  FROM lunch_orders
  WHERE id = p_order_id
    AND is_cancelled = false
    AND status <> 'cancelled'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'El pedido no existe o ya fue cancelado.',
      'error_code', 'ALREADY_CANCELLED'
    );
  END IF;

  -- ── Paso 2: Motivo efectivo ───────────────────────────────────────────────
  v_effective_reason := COALESCE(
    NULLIF(TRIM(p_reason), ''),
    'Pedido anulado por ' || v_caller_role
  );

  -- ── Paso 3: Buscar la transacción vinculada ───────────────────────────────
  SELECT id, payment_status, billing_status
  INTO v_tx_id, v_tx_payment_status, v_tx_billing_status
  FROM transactions
  WHERE metadata->>'lunch_order_id' = p_order_id::text
    AND is_deleted = false
  ORDER BY created_at DESC
  LIMIT 1;

  -- ── Paso 4: Decidir qué hacer con la transacción ─────────────────────────
  IF v_tx_id IS NOT NULL THEN
    IF v_tx_billing_status = 'sent' THEN
      -- Ya está en SUNAT: no tocar — el admin debe emitir nota de crédito.
      v_already_billed := true;
    ELSE
      -- No boleteada: cancelar la transacción.
      UPDATE transactions
      SET
        payment_status = 'cancelled',
        metadata = metadata || jsonb_build_object(
          'cancelled_at',  now()::text,
          'cancelled_by',  p_cancelled_by::text,
          'cancel_reason', v_effective_reason
        )
      WHERE id = v_tx_id;

      v_tx_cancelled := true;
    END IF;
  END IF;

  -- ── Paso 5: Cancelar el pedido ────────────────────────────────────────────
  UPDATE lunch_orders
  SET
    is_cancelled        = true,
    status              = 'cancelled',
    cancelled_by        = p_cancelled_by,
    cancelled_at        = now(),
    cancellation_reason = CASE
      WHEN v_already_billed
        THEN v_effective_reason || ' — transacción ya boleteada en SUNAT (requiere nota de crédito)'
      ELSE v_effective_reason
    END
  WHERE id = p_order_id;

  -- ── Paso 6: Resultado ─────────────────────────────────────────────────────
  RETURN json_build_object(
    'success',          true,
    'order_cancelled',  true,
    'tx_cancelled',     v_tx_cancelled,
    'already_billed',   v_already_billed,
    'tx_id',            v_tx_id,
    'reason',           v_effective_reason
  );

END;
$$;

-- El grant ya existía; lo re-aplicamos por si acaso.
GRANT EXECUTE ON FUNCTION cancel_lunch_order(UUID, UUID, TEXT) TO authenticated;
