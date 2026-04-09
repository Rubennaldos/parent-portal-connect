-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: COALESCE types uuid[] and jsonb cannot be matched
-- en RPC process_traditional_voucher_approval
--
-- Causa: COALESCE(v_updated_ids, '[]'::jsonb) mezcla tipos incompatibles.
--   v_updated_ids es uuid[] pero '[]'::jsonb es jsonb.
--   PostgreSQL no puede combinar automáticamente uuid[] con jsonb en COALESCE.
--
-- Solución: convertir v_updated_ids a jsonb primero con to_jsonb(),
--   usando '{}'::uuid[] como valor por defecto vacío dentro del COALESCE
--   (ambos del mismo tipo uuid[]) ANTES de convertir a jsonb.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_traditional_voucher_approval(
  p_request_id  uuid,
  p_admin_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_req            record;
  v_lunch_ids      uuid[];
  v_tx_ids         uuid[];
  v_updated_ids    uuid[];
  v_total_debt     numeric := 0;
  v_total_approved numeric := 0;
  v_is_partial     boolean := false;
  v_billing_status text;
  v_is_taxable     boolean;
BEGIN

  -- ── PASO 1: BLOQUEO OPTIMISTA ──────────────────────────────────────────────
  SELECT * INTO v_req
  FROM   recharge_requests
  WHERE  id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: La solicitud % no existe.', p_request_id;
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_PROCESSED: La solicitud % ya fue procesada (estado actual: %).',
      p_request_id, v_req.status;
  END IF;

  -- ── PASO 2: MARCAR SOLICITUD COMO APROBADA ────────────────────────────────
  UPDATE recharge_requests
  SET
    status      = 'approved',
    approved_by = p_admin_id,
    approved_at = NOW()
  WHERE id = p_request_id;

  -- ── PASO 3: RECOPILAR IDs DE TRANSACCIONES ────────────────────────────────
  v_lunch_ids := COALESCE(v_req.lunch_order_ids, '{}');

  SELECT array_agg(DISTINCT t_id) INTO v_tx_ids
  FROM (
    -- Fuente A: paid_transaction_ids explícitos
    SELECT unnest(v_req.paid_transaction_ids) AS t_id
    WHERE  v_req.paid_transaction_ids IS NOT NULL
      AND  array_length(v_req.paid_transaction_ids, 1) > 0

    UNION

    -- Fuente B: transacciones pendientes vinculadas a los lunch_order_ids por metadata JSONB
    SELECT t.id AS t_id
    FROM   transactions t
    WHERE  array_length(v_lunch_ids, 1) > 0
      AND  (t.metadata->>'lunch_order_id')::uuid = ANY(v_lunch_ids)
      AND  t.type           = 'purchase'
      AND  t.payment_status IN ('pending', 'partial')
      AND  t.is_deleted     = false
  ) combined;

  -- Validar que existe algo que procesar
  IF (v_tx_ids IS NULL OR array_length(v_tx_ids, 1) = 0)
     AND (v_lunch_ids IS NULL OR array_length(v_lunch_ids, 1) = 0)
     AND (v_req.paid_transaction_ids IS NULL OR array_length(v_req.paid_transaction_ids, 1) = 0)
  THEN
    RAISE EXCEPTION
      'NO_DEBTS_FOUND: La solicitud % no tiene transacciones ni almuerzos vinculados. '
      'Edita los campos paid_transaction_ids y/o lunch_order_ids antes de aprobar.',
      p_request_id;
  END IF;

  -- ── PASO 4: VERIFICAR PAGO PARCIAL (solo lunch_payment con lunch_order_ids) ─
  IF v_req.request_type = 'lunch_payment'
     AND array_length(v_lunch_ids, 1) > 0
  THEN
    SELECT COALESCE(SUM(ABS(COALESCE(lo.final_price, 0))), 0)
    INTO   v_total_debt
    FROM   lunch_orders lo
    WHERE  lo.id = ANY(v_lunch_ids)
      AND  lo.is_cancelled = false;

    SELECT COALESCE(SUM(rr.amount), 0)
    INTO   v_total_approved
    FROM   recharge_requests rr
    WHERE  rr.student_id   = v_req.student_id
      AND  rr.request_type IN ('lunch_payment', 'debt_payment')
      AND  rr.status       = 'approved'
      AND  rr.lunch_order_ids && v_lunch_ids;

    v_is_partial := (v_total_approved < (v_total_debt - 0.50));
  END IF;

  -- ── PASO 5: ACTUALIZAR TRANSACCIONES (solo si pago completo) ─────────────
  IF NOT v_is_partial THEN

    IF v_req.payment_method IN ('efectivo', 'cash', 'saldo', 'pagar_luego', 'adjustment') THEN
      v_is_taxable    := false;
      v_billing_status := 'excluded';
    ELSE
      v_is_taxable    := true;
      v_billing_status := 'pending';
    END IF;

    UPDATE transactions t
    SET
      payment_status = 'paid',
      payment_method = v_req.payment_method,
      is_taxable     = v_is_taxable,
      billing_status = v_billing_status,
      metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
        'payment_approved',    true,
        'payment_source',      CASE v_req.request_type
                                 WHEN 'debt_payment'  THEN 'debt_voucher_payment'
                                 WHEN 'lunch_payment' THEN 'lunch_voucher_payment'
                                 ELSE                      'voucher_payment'
                               END,
        'recharge_request_id', p_request_id::text,
        'reference_code',      v_req.reference_code,
        'approved_by',         p_admin_id::text,
        'approved_at',         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'voucher_url',         v_req.voucher_url,
        'last_payment_rejected', false
      )
    WHERE  t.id            = ANY(v_tx_ids)
      AND  t.payment_status IN ('pending', 'partial')
      AND  t.is_deleted    = false;

    SELECT array_agg(t.id) INTO v_updated_ids
    FROM   transactions t
    WHERE  t.id            = ANY(v_tx_ids)
      AND  t.payment_status = 'paid'
      AND  t.is_deleted     = false;

    -- ── PASO 6: CONFIRMAR LUNCH_ORDERS ACTIVOS ──────────────────────────────
    IF array_length(v_lunch_ids, 1) > 0 THEN
      UPDATE lunch_orders
      SET    status = 'confirmed'
      WHERE  id          = ANY(v_lunch_ids)
        AND  is_cancelled = false
        AND  status      <> 'cancelled';
    END IF;

    IF v_updated_ids IS NOT NULL AND array_length(v_updated_ids, 1) > 0 THEN
      UPDATE lunch_orders lo
      SET    status = 'confirmed'
      FROM   transactions t
      WHERE  t.id           = ANY(v_updated_ids)
        AND  (t.metadata->>'lunch_order_id') IS NOT NULL
        AND  lo.id           = (t.metadata->>'lunch_order_id')::uuid
        AND  lo.is_cancelled = false
        AND  lo.status      <> 'cancelled';
    END IF;

  END IF;  -- END if not partial

  -- ── PASO 7: AUDITORÍA ──────────────────────────────────────────────────────
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      p_admin_id,
      'APROBACION_VOUCHER_TRADICIONAL',
      'COBRANZAS',
      jsonb_build_object(
        'request_id',    p_request_id,
        'request_type',  v_req.request_type,
        'amount',        v_req.amount,
        'student_id',    v_req.student_id,
        'is_partial',    v_is_partial,
        'tx_updated',    v_updated_ids,
        'lunch_ids',     v_lunch_ids,
        'total_debt',    v_total_debt,
        'total_approved', v_total_approved
      ),
      v_req.school_id,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Auditoría falló en process_traditional_voucher_approval: %', SQLERRM;
  END;

  -- ── PASO 8: RETORNO ────────────────────────────────────────────────────────
  -- FIX: COALESCE(v_updated_ids, '[]'::jsonb) fallaba porque uuid[] y jsonb
  -- son tipos incompatibles en COALESCE. Solución: to_jsonb() convierte uuid[]
  -- a jsonb, y el fallback también es jsonb ('[]'::jsonb). Ambos del mismo tipo.
  RETURN jsonb_build_object(
    'success',             true,
    'approved_request_id', p_request_id,
    'updated_tx_ids',      to_jsonb(COALESCE(v_updated_ids, '{}'::uuid[])),
    'amount',              v_req.amount,
    'student_id',          v_req.student_id,
    'school_id',           v_req.school_id,
    'payment_method',      v_req.payment_method,
    'billing_status_set',  COALESCE(v_billing_status, 'excluded'),
    'invoice_type',        v_req.invoice_type,
    'invoice_client_data', v_req.invoice_client_data,
    'is_partial',          v_is_partial,
    'total_debt',          v_total_debt,
    'total_approved',      v_total_approved,
    'shortage',            GREATEST(0, v_total_debt - v_total_approved)
  );

END;
$func$;

GRANT EXECUTE ON FUNCTION process_traditional_voucher_approval(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION process_traditional_voucher_approval IS
  'v2 — Fix COALESCE uuid[] vs jsonb (usa to_jsonb() en PASO 8). '
  'Aprueba un voucher de lunch_payment o debt_payment de forma atómica. '
  'Bloquea con FOR UPDATE, valida estado pending, actualiza transacciones en batch, '
  'confirma lunch_orders, y retorna los IDs necesarios para que el frontend llame a Nubefact.';
