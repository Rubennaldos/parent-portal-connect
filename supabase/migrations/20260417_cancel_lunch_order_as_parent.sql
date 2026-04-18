-- ════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: cancel_lunch_order_as_parent
-- Fecha: 2026-04-17
--
-- PROPÓSITO:
--   Separar la anulación de pedidos de almuerzo en dos funciones:
--     • cancel_lunch_order        → solo admins (admin_sede, admin_general, superadmin)
--     • cancel_lunch_order_as_parent → padres que anulan su propio pedido
--
--   La función anterior cancel_lunch_order (v2) agregó un guard de rol que
--   bloqueaba a los padres. Esta migración resuelve ese bloqueo.
--
-- RESTRICCIONES:
--   1. El padre debe ser el tutor del alumno del pedido.
--   2. Solo se puede anular antes de la hora/día de corte configurada.
--      Replica la lógica del frontend (cancellation_deadline_days + time).
--   3. FOR UPDATE previene doble anulación concurrente.
--   4. NO toca students.balance.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS cancel_lunch_order_as_parent(UUID, UUID);

CREATE OR REPLACE FUNCTION cancel_lunch_order_as_parent(
  p_order_id  UUID,
  p_parent_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_date        DATE;
  v_order_school_id   UUID;
  v_student_parent_id UUID;
  v_deadline_time     TIME;
  v_deadline_days     INT;
  v_lima_now          TIMESTAMP;
  v_cutoff_datetime   TIMESTAMP;
  v_tx_id             UUID;
  v_tx_billing_status TEXT;
  v_tx_cancelled      BOOLEAN := false;
  v_already_billed    BOOLEAN := false;
BEGIN

  -- ── Guard 1: Verificar que el pedido existe y pertenece al hijo del padre ─
  SELECT lo.order_date, lo.school_id, s.parent_id
  INTO   v_order_date, v_order_school_id, v_student_parent_id
  FROM   lunch_orders lo
  JOIN   students s ON s.id = lo.student_id
  WHERE  lo.id = p_order_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'El pedido no existe.',
      'error_code', 'ORDER_NOT_FOUND'
    );
  END IF;

  IF v_student_parent_id <> p_parent_id THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'No tienes permiso para anular este pedido.',
      'error_code', 'FORBIDDEN'
    );
  END IF;

  -- ── Guard 2: Verificar hora/día de corte (replicando lógica del frontend) ─
  -- cutoff = (order_date - cancellation_deadline_days) a las deadline_time en Lima
  SELECT
    COALESCE(cancellation_deadline_time, '09:00:00'::TIME),
    COALESCE(cancellation_deadline_days, 0)
  INTO v_deadline_time, v_deadline_days
  FROM lunch_configuration
  WHERE school_id = v_order_school_id
  LIMIT 1;

  -- Si no hay configuración usar defaults seguros
  v_deadline_time := COALESCE(v_deadline_time, '09:00:00'::TIME);
  v_deadline_days := COALESCE(v_deadline_days, 0);

  v_lima_now        := NOW() AT TIME ZONE 'America/Lima';
  v_cutoff_datetime := (v_order_date - v_deadline_days)::TIMESTAMP + v_deadline_time;

  IF v_lima_now >= v_cutoff_datetime THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'La hora de corte ya pasó. Solo puedes anular pedidos antes de las '
                    || TO_CHAR(v_deadline_time, 'HH12:MI AM') || '.',
      'error_code', 'AFTER_CUTOFF',
      'deadline',   TO_CHAR(v_deadline_time, 'HH12:MI AM')
    );
  END IF;

  -- ── Guard 3: Bloqueo de fila (FOR UPDATE → previene doble anulación) ─────
  PERFORM 1
  FROM lunch_orders
  WHERE id           = p_order_id
    AND is_cancelled = false
    AND status      <> 'cancelled'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'El pedido ya fue cancelado.',
      'error_code', 'ALREADY_CANCELLED'
    );
  END IF;

  -- ── Paso 4: Buscar transacción vinculada ─────────────────────────────────
  SELECT id, billing_status
  INTO   v_tx_id, v_tx_billing_status
  FROM   transactions
  WHERE  metadata->>'lunch_order_id' = p_order_id::text
    AND  is_deleted = false
  ORDER BY created_at DESC
  LIMIT 1;

  -- ── Paso 5: Decidir qué hacer con la transacción ─────────────────────────
  IF v_tx_id IS NOT NULL THEN
    IF v_tx_billing_status = 'sent' THEN
      -- Ya boleteada en SUNAT: no tocar
      v_already_billed := true;
    ELSE
      UPDATE transactions
      SET
        payment_status = 'cancelled',
        metadata = COALESCE(metadata, '{}') || jsonb_build_object(
          'cancelled_at',  to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'cancelled_by',  p_parent_id::text,
          'cancel_reason', 'Anulado por padre/tutor'
        )
      WHERE id = v_tx_id;

      v_tx_cancelled := true;
    END IF;
  END IF;

  -- ── Paso 6: Cancelar el pedido ────────────────────────────────────────────
  UPDATE lunch_orders
  SET
    is_cancelled        = true,
    status              = 'cancelled',
    cancelled_by        = p_parent_id,
    cancelled_at        = NOW(),
    cancellation_reason = CASE
      WHEN v_already_billed
        THEN 'Anulado por padre/tutor — transacción ya boleteada en SUNAT (requiere nota de crédito)'
      ELSE 'Anulado por padre/tutor'
    END
  WHERE id = p_order_id;

  -- ── Paso 7: Resultado ─────────────────────────────────────────────────────
  RETURN json_build_object(
    'success',         true,
    'order_cancelled', true,
    'tx_cancelled',    v_tx_cancelled,
    'already_billed',  v_already_billed,
    'tx_id',           v_tx_id
  );

END;
$$;

GRANT EXECUTE ON FUNCTION cancel_lunch_order_as_parent(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'cancel_lunch_order_as_parent creado OK' AS resultado;
