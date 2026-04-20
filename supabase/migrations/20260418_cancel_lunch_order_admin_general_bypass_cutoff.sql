-- admin_general puede anular fuera de la hora de corte (correcciones / historial).
-- admin_sede y superadmin siguen sujetos al guard AFTER_CUTOFF.

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
  SELECT school_id INTO v_order_school_id
  FROM lunch_orders
  WHERE id = p_order_id;

  SELECT cancellation_deadline_time INTO v_deadline_time
  FROM lunch_configuration
  WHERE school_id = v_order_school_id
  LIMIT 1;

  v_deadline_time := COALESCE(v_deadline_time, '09:00:00'::TIME);

  v_lima_time := (NOW() AT TIME ZONE 'America/Lima')::TIME;

  -- Solo admin_sede y superadmin quedan bloqueados tras el corte; admin_general no.
  IF v_caller_role IS DISTINCT FROM 'admin_general' AND v_lima_time >= v_deadline_time THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'La hora de corte ya pasó. Solo se pueden anular pedidos antes de las '
                    || TO_CHAR(v_deadline_time, 'HH12:MI AM') || '.',
      'error_code', 'AFTER_CUTOFF',
      'deadline',   TO_CHAR(v_deadline_time, 'HH12:MI AM')
    );
  END IF;

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

  v_effective_reason := COALESCE(
    NULLIF(TRIM(p_reason), ''),
    'Pedido anulado por ' || v_caller_role
  );

  SELECT id, payment_status, billing_status
  INTO v_tx_id, v_tx_payment_status, v_tx_billing_status
  FROM transactions
  WHERE metadata->>'lunch_order_id' = p_order_id::text
    AND is_deleted = false
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_tx_id IS NOT NULL THEN
    IF v_tx_billing_status = 'sent' THEN
      v_already_billed := true;
    ELSE
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

GRANT EXECUTE ON FUNCTION cancel_lunch_order(UUID, UUID, TEXT) TO authenticated;
