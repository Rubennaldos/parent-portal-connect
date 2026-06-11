-- ============================================================================
-- FASE 2: RPC seguro para devolución de saldo con Nota de Crédito aceptada
-- ============================================================================

DROP FUNCTION IF EXISTS public.void_pos_sale_with_nc(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.void_pos_sale_with_nc(
  p_transaction_id uuid,
  p_admin_id uuid,
  p_reason text DEFAULT 'Devolución de saldo al alumno con NC'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id            uuid;
  v_actor_role          text;
  v_actor_school_id     uuid;

  v_tx                  transactions%ROWTYPE;
  v_nc                  invoices%ROWTYPE;

  v_balance_refund      numeric := 0;
  v_new_balance         numeric := 0;
  v_now_lima            timestamp := timezone('America/Lima', now());
BEGIN
  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: El ID de la transacción es obligatorio.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: El ID del administrador es obligatorio.'
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(length(trim(p_reason)), 0) < 5 THEN
    RAISE EXCEPTION 'INVALID_INPUT: El motivo debe tener al menos 5 caracteres.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Identidad real: evita suplantación de p_admin_id
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_actor_id <> p_admin_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: p_admin_id no coincide con auth.uid().'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.role, p.school_id
  INTO v_actor_role, v_actor_school_id
  FROM profiles p
  WHERE p.id = v_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Perfil no encontrado para el usuario autenticado.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_actor_role NOT IN ('admin_general', 'superadmin', 'gestor_unidad') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Rol % no autorizado para esta operación.', v_actor_role
      USING ERRCODE = 'P0001';
  END IF;

  -- Candado de concurrencia sobre la venta objetivo
  SELECT *
  INTO v_tx
  FROM transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: La transacción % no existe.', p_transaction_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Control multi-sede (excepto admin_general/superadmin)
  IF v_actor_role NOT IN ('admin_general', 'superadmin')
     AND v_tx.school_id IS DISTINCT FROM v_actor_school_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: No puede operar ventas de otra sede.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotencia y estado válido
  IF COALESCE(v_tx.is_deleted, false) THEN
    RAISE EXCEPTION 'INVALID_STATE: La transacción está eliminada lógicamente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.payment_status = 'cancelled' THEN
    RAISE EXCEPTION 'IDEMPOTENT_ABORT: La venta ya fue cancelada operativamente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'INVALID_STATE: Solo se puede devolver saldo para ventas en estado paid. Estado actual: %.', v_tx.payment_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.invoice_id IS NULL OR v_tx.billing_status <> 'sent' THEN
    RAISE EXCEPTION 'INVALID_STATE: La venta no cumple sent + invoice_id.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validación fiscal: NC accepted amarrada al comprobante original
  SELECT i.*
  INTO v_nc
  FROM invoices i
  WHERE i.document_type_code = '07'
    AND i.original_invoice_id = v_tx.invoice_id
    AND i.sunat_status = 'accepted'
  ORDER BY i.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NC_REQUIRED: No existe Nota de Crédito accepted para este comprobante.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Bypass controlado de SUNAT_INTEGRITY (scope local a la transacción)
  PERFORM set_config('app.void_payment_bypass', 'true', true);

  -- Actualización operativa + mochila de auditoría en metadata
  UPDATE transactions t
  SET
    payment_status = 'cancelled',
    metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by',           v_actor_id::text,
      'cancelled_at',           to_char(v_now_lima, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'cancellation_reason',    p_reason,
      'credit_note_invoice_id', v_nc.id::text,
      'void_source',            'void_pos_sale_with_nc'
    )
  WHERE t.id = v_tx.id
    AND t.payment_status = 'paid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONCURRENT_ABORT: La fila cambió durante el proceso.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Devolución de saldo: solo para alumno
  IF v_tx.student_id IS NOT NULL THEN
    v_balance_refund := CASE WHEN v_tx.amount < 0 THEN ABS(v_tx.amount) ELSE 0 END;
    IF v_balance_refund > 0 THEN
      v_new_balance := public.adjust_student_balance(v_tx.student_id, v_balance_refund);
    END IF;
  END IF;

  -- Auditoría estructurada (obligatoria)
  INSERT INTO public.audit_billing_logs (
    action_type,
    table_name,
    record_id,
    old_data,
    new_data,
    changed_by_user_id,
    school_id,
    created_at
  ) VALUES (
    'VOID_POS_SALE_WITH_NC',
    'transactions',
    v_tx.id,
    jsonb_build_object(
      'payment_status', v_tx.payment_status,
      'metadata', v_tx.metadata
    ),
    jsonb_build_object(
      'payment_status', 'cancelled',
      'credit_note_invoice_id', v_nc.id,
      'balance_refunded', v_balance_refund,
      'new_balance_operativo', v_new_balance,
      'reason', p_reason
    ),
    v_actor_id,
    v_tx.school_id,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx.id,
    'credit_note_invoice_id', v_nc.id,
    'balance_refunded', v_balance_refund,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.void_pos_sale_with_nc(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_pos_sale_with_nc(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.void_pos_sale_with_nc(uuid, uuid, text) IS
  'FASE 2: devolución de saldo al alumno con NC accepted; incluye FOR UPDATE, idempotencia, auth.uid, control sede/rol, bypass SUNAT y auditoría JSONB.';
