-- ============================================================
-- PARCHE DE SEGURIDAD: Hardening de inputs en RPCs de Billetera
-- ============================================================
-- Problema encontrado en auditoría de Caos QA:
--   Un atacante puede enviar wallet_amount = -50 con un
--   voucher_amount positivo. Las validaciones existentes en
--   submit_voucher_with_split solo verifican el saldo cuando
--   wallet_amount > 0, pero no bloquean explícitamente
--   valores negativos antes del INSERT.
--   El CHECK constraint de la tabla sí lo bloquea, pero
--   el error que llega al padre es un mensaje SQL crudo.
--
-- Fix: agregar validación explícita ANTES del INSERT para
-- lanzar un RAISE EXCEPTION con mensaje amigable.
-- También se agrega ROUND(..., 2) para prevenir valores como
-- 15.00000001 que podrían evadir la comparación exacta.
-- ============================================================


-- ════════════════════════════════════════════════════════════════
-- PATCH: submit_voucher_with_split — validar negativos y redondear
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submit_voucher_with_split(
  p_student_id          uuid,
  p_debt_tx_ids         uuid[]       DEFAULT '{}',
  p_lunch_order_ids     uuid[]       DEFAULT '{}',
  p_wallet_amount       numeric      DEFAULT 0,
  p_voucher_amount      numeric      DEFAULT 0,
  p_voucher_url         text         DEFAULT NULL,
  p_reference_code      text         DEFAULT NULL,
  p_invoice_type        text         DEFAULT NULL,
  p_invoice_client_data jsonb        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_student        record;
  v_school_id      uuid;
  v_request_id     uuid;
  v_total_debt     numeric;
BEGIN
  -- ── AUTENTICACIÓN ─────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  -- ── REDONDEAR INPUTS A 2 DECIMALES (previene 15.00000001) ─────────────────
  p_wallet_amount  := ROUND(COALESCE(p_wallet_amount,  0), 2);
  p_voucher_amount := ROUND(COALESCE(p_voucher_amount, 0), 2);

  -- ── VALIDAR QUE LOS MONTOS NO SON NEGATIVOS ───────────────────────────────
  -- Esto da un mensaje amigable antes de que el CHECK constraint lo rechace
  IF p_wallet_amount < 0 THEN
    RAISE EXCEPTION
      'INVALID_AMOUNT: El monto de billetera no puede ser negativo (recibido: S/ %)',
      p_wallet_amount;
  END IF;
  IF p_voucher_amount < 0 THEN
    RAISE EXCEPTION
      'INVALID_AMOUNT: El monto del voucher no puede ser negativo (recibido: S/ %)',
      p_voucher_amount;
  END IF;

  -- Al menos uno de los dos montos debe ser > 0
  IF p_wallet_amount = 0 AND p_voucher_amount = 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNTS: Ambos montos son 0. Nada que pagar.';
  END IF;

  -- ── VALIDAR QUE EL ALUMNO PERTENECE A ESTE PADRE ──────────────────────────
  SELECT id, wallet_balance, school_id, full_name
  INTO   v_student
  FROM   students
  WHERE  id = p_student_id
    AND  parent_id = v_caller_id
    AND  is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: El alumno no pertenece a este padre';
  END IF;

  v_school_id := v_student.school_id;

  -- ── VALIDAR SALDO DE BILLETERA (en la BD, no en el cliente) ───────────────
  IF p_wallet_amount > 0 AND v_student.wallet_balance < p_wallet_amount THEN
    RAISE EXCEPTION
      'INSUFFICIENT_WALLET: Saldo insuficiente. '
      'Disponible: S/ %, solicitado: S/ %',
      v_student.wallet_balance, p_wallet_amount;
  END IF;

  -- ── VALIDAR QUE LAS DEUDAS EXISTEN Y PERTENECEN AL ALUMNO ─────────────────
  IF array_length(p_debt_tx_ids, 1) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM transactions
      WHERE id = ANY(p_debt_tx_ids)
        AND (student_id != p_student_id OR payment_status NOT IN ('pending', 'partial'))
    ) THEN
      RAISE EXCEPTION
        'INVALID_DEBTS: Algunas transacciones no pertenecen al alumno '
        'o ya no están pendientes';
    END IF;
  END IF;

  -- ── CREAR EL RECHARGE_REQUEST ──────────────────────────────────────────────
  INSERT INTO recharge_requests (
    student_id,
    parent_id,
    school_id,
    amount,
    wallet_amount,
    payment_method,
    reference_code,
    voucher_url,
    status,
    request_type,
    description,
    paid_transaction_ids,
    lunch_order_ids,
    invoice_type,
    invoice_client_data
  ) VALUES (
    p_student_id,
    v_caller_id,
    v_school_id,
    p_voucher_amount,
    p_wallet_amount,
    'transferencia',
    p_reference_code,
    p_voucher_url,
    'pending',
    'debt_payment',
    CASE
      WHEN p_wallet_amount > 0
        THEN 'Pago dividido: S/ ' || p_wallet_amount ||
             ' de billetera + S/ ' || p_voucher_amount || ' de voucher'
      ELSE 'Pago de deuda pendiente'
    END,
    CASE WHEN array_length(p_debt_tx_ids,    1) > 0 THEN p_debt_tx_ids    ELSE NULL END,
    CASE WHEN array_length(p_lunch_order_ids, 1) > 0 THEN p_lunch_order_ids ELSE NULL END,
    p_invoice_type,
    p_invoice_client_data
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success',          true,
    'request_id',       v_request_id,
    'wallet_amount',    p_wallet_amount,
    'voucher_amount',   p_voucher_amount,
    'message',
      CASE
        WHEN p_wallet_amount > 0
          THEN 'Solicitud enviada. S/ ' || p_wallet_amount ||
               ' de billetera + S/ ' || p_voucher_amount || ' de voucher. '
               'Espera la aprobación del administrador.'
        ELSE 'Solicitud de pago enviada. Espera la aprobación del administrador.'
      END
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_voucher_with_split(uuid, uuid[], uuid[], numeric, numeric, text, text, text, jsonb)
  TO authenticated;

COMMENT ON FUNCTION submit_voucher_with_split IS
  'VERSIÓN HARDENED: Incluye redondeo a 2 decimales y validación explícita '
  'de montos negativos antes del INSERT, para evitar que un atacante envíe '
  'wallet_amount negativo y obtenga un mensaje SQL crudo del CHECK constraint.';
