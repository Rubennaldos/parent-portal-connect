-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: process_traditional_voucher_approval v4
-- Fecha: 2026-04-09
--
-- BUGS CORREGIDOS:
--
-- BUG 1 — Regresión crítica: COALESCE types uuid[] and jsonb cannot be matched
--   En el RETURN del RPC (PASO 8), la línea:
--       'updated_tx_ids', COALESCE(v_updated_ids, '[]'::jsonb)
--   intentaba hacer COALESCE entre uuid[] y jsonb, tipos incompatibles en PostgreSQL.
--   Postgres no tiene un cast implícito entre ellos → el RPC lanzaba error 400 (Bad Request).
--
--   FIX: usar to_jsonb() para convertir el uuid[] primero, luego dar el fallback:
--       'updated_tx_ids', to_jsonb(COALESCE(v_updated_ids, '{}'::uuid[]))
--
-- BUG 2 — array_length() sobre arrays vacíos devuelve NULL (no 0)
--   En PASO 3 (Fuente A) se usaba array_length(...) que devuelve NULL para '{}'.
--   Esto hacía que la condición del UNION fallara silenciosamente.
--   FIX: reemplazar por COALESCE(cardinality(...), 0) > 0 de forma consistente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_traditional_voucher_approval(
  p_request_id  uuid,
  p_admin_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req             record;
  v_lunch_ids       uuid[];
  v_tx_ids          uuid[];
  v_updated_ids     uuid[];
  v_total_debt      numeric := 0;
  v_total_approved  numeric := 0;
  v_is_partial      boolean := false;
  v_billing_status  text;
  v_is_taxable      boolean;

  -- Variables para el barrido FIFO (deuda kiosco sin IDs explícitos)
  v_needs_fifo      boolean := false;
  v_fifo_rec        record;
  v_fifo_ids        uuid[]  := '{}';
  v_fifo_running    numeric := 0;
  v_balance_credit  numeric := 0;
  v_student_balance numeric := 0;

  -- Variable para el ajuste de balance con IDs explícitos (PASO 6c)
  v_kiosk_paid_sum  numeric := 0;
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
    -- FIX: usar cardinality() que devuelve 0 para '{}' (array_length devuelve NULL)
    SELECT unnest(v_req.paid_transaction_ids) AS t_id
    WHERE  v_req.paid_transaction_ids IS NOT NULL
      AND  COALESCE(cardinality(v_req.paid_transaction_ids), 0) > 0

    UNION

    -- Fuente B: transacciones pendientes vinculadas a lunch_order_ids por metadata
    SELECT t.id AS t_id
    FROM   transactions t
    WHERE  COALESCE(cardinality(v_lunch_ids), 0) > 0
      AND  (t.metadata->>'lunch_order_id')::uuid = ANY(v_lunch_ids)
      AND  t.type           = 'purchase'
      AND  t.payment_status IN ('pending', 'partial')
      AND  t.is_deleted     = false
  ) combined;

  -- ── PASO 3b: BARRIDO FIFO CUANDO NO HAY IDs EXPLÍCITOS ───────────────────
  -- Cubre el caso "Deuda de Kiosco" donde el ID es sintético y no llega al RPC.
  IF COALESCE(cardinality(v_tx_ids), 0) = 0
     AND COALESCE(cardinality(v_lunch_ids), 0) = 0
  THEN
    v_needs_fifo   := true;
    v_fifo_running := 0;
    v_fifo_ids     := '{}';

    FOR v_fifo_rec IN (
      SELECT t.id, ABS(t.amount) AS abs_amt
      FROM   transactions t
      WHERE  t.student_id     = v_req.student_id
        AND  t.type           = 'purchase'
        AND  t.is_deleted     = false
        AND  t.payment_status IN ('pending', 'partial')
        AND  (t.metadata->>'lunch_order_id') IS NULL
      ORDER BY t.created_at ASC
    ) LOOP
      EXIT WHEN v_fifo_running >= (v_req.amount + 0.10);

      IF v_fifo_running + v_fifo_rec.abs_amt <= v_req.amount + 0.10 THEN
        v_fifo_ids     := array_append(v_fifo_ids, v_fifo_rec.id);
        v_fifo_running := v_fifo_running + v_fifo_rec.abs_amt;
      END IF;
    END LOOP;

    IF COALESCE(cardinality(v_fifo_ids), 0) > 0 THEN
      v_tx_ids := v_fifo_ids;
    END IF;

    v_balance_credit := GREATEST(0, v_req.amount - v_fifo_running);

    IF COALESCE(cardinality(v_tx_ids), 0) = 0 THEN
      SELECT balance INTO v_student_balance
      FROM   students
      WHERE  id = v_req.student_id;

      IF COALESCE(v_student_balance, 0) >= 0 THEN
        RAISE EXCEPTION
          'NO_DEBTS_FOUND: El alumno no tiene transacciones POS pendientes ni saldo negativo. '
          'La solicitud % no tiene deuda que saldar. '
          'Si el error persiste, coordina con soporte para revisión manual.',
          p_request_id;
      END IF;
    END IF;
  END IF;

  -- ── PASO 4: VERIFICAR PAGO PARCIAL ────────────────────────────────────────
  IF v_req.request_type = 'lunch_payment'
     AND COALESCE(cardinality(v_lunch_ids), 0) > 0
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

  -- ── PASO 5: ACTUALIZAR TRANSACCIONES ─────────────────────────────────────
  IF NOT v_is_partial THEN

    IF v_req.payment_method IN ('efectivo', 'cash', 'saldo', 'pagar_luego', 'adjustment') THEN
      v_is_taxable    := false;
      v_billing_status := 'excluded';
    ELSE
      v_is_taxable    := true;
      v_billing_status := 'pending';
    END IF;

    IF COALESCE(cardinality(v_tx_ids), 0) > 0 THEN
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
    END IF;

    SELECT array_agg(t.id) INTO v_updated_ids
    FROM   transactions t
    WHERE  t.id            = ANY(v_tx_ids)
      AND  t.payment_status = 'paid'
      AND  t.is_deleted     = false;

    -- ── PASO 6: CONFIRMAR LUNCH_ORDERS ──────────────────────────────────────
    IF COALESCE(cardinality(v_lunch_ids), 0) > 0 THEN
      UPDATE lunch_orders
      SET    status = 'confirmed'
      WHERE  id          = ANY(v_lunch_ids)
        AND  is_cancelled = false
        AND  status      <> 'cancelled';
    END IF;

    IF COALESCE(cardinality(v_updated_ids), 0) > 0 THEN
      UPDATE lunch_orders lo
      SET    status = 'confirmed'
      FROM   transactions t
      WHERE  t.id           = ANY(v_updated_ids)
        AND  (t.metadata->>'lunch_order_id') IS NOT NULL
        AND  lo.id           = (t.metadata->>'lunch_order_id')::uuid
        AND  lo.is_cancelled = false
        AND  lo.status      <> 'cancelled';
    END IF;

    -- ── PASO 6b: AJUSTE DE BALANCE — CAMINO FIFO ────────────────────────────
    IF v_needs_fifo AND v_balance_credit > 0.01 THEN
      SELECT balance INTO v_student_balance
      FROM   students
      WHERE  id = v_req.student_id;

      IF COALESCE(v_student_balance, 0) < 0 THEN
        PERFORM adjust_student_balance(
          v_req.student_id,
          LEAST(v_balance_credit, ABS(v_student_balance))
        );
      END IF;
    END IF;

    -- ── PASO 6c: AJUSTE DE BALANCE — CAMINO EXPLÍCITO ───────────────────────
    IF NOT v_needs_fifo AND COALESCE(cardinality(v_updated_ids), 0) > 0 THEN
      SELECT COALESCE(SUM(ABS(t.amount)), 0)
      INTO   v_kiosk_paid_sum
      FROM   transactions t
      WHERE  t.id = ANY(v_updated_ids)
        AND  (t.metadata->>'lunch_order_id') IS NULL;

      IF v_kiosk_paid_sum > 0.01 THEN
        SELECT balance INTO v_student_balance
        FROM   students
        WHERE  id = v_req.student_id;

        IF COALESCE(v_student_balance, 0) < 0 THEN
          PERFORM adjust_student_balance(
            v_req.student_id,
            LEAST(v_kiosk_paid_sum, ABS(v_student_balance))
          );
        END IF;
      END IF;
    END IF;

  END IF;  -- END if not partial

  -- ── PASO 7: AUDITORÍA ──────────────────────────────────────────────────────
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id, accion, modulo, contexto, school_id, creado_at
    ) VALUES (
      p_admin_id,
      'APROBACION_VOUCHER_TRADICIONAL',
      'COBRANZAS',
      jsonb_build_object(
        'request_id',             p_request_id,
        'request_type',           v_req.request_type,
        'amount',                 v_req.amount,
        'student_id',             v_req.student_id,
        'is_partial',             v_is_partial,
        'tx_updated',             to_jsonb(COALESCE(v_updated_ids, '{}'::uuid[])),
        'lunch_ids',              to_jsonb(COALESCE(v_lunch_ids,   '{}'::uuid[])),
        'total_debt',             v_total_debt,
        'total_approved',         v_total_approved,
        'fifo_used',              v_needs_fifo,
        'fifo_tx_count',          COALESCE(cardinality(v_fifo_ids), 0),
        'balance_credit',         v_balance_credit,
        'kiosk_balance_restored', v_kiosk_paid_sum
      ),
      v_req.school_id,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Auditoría falló en process_traditional_voucher_approval: %', SQLERRM;
  END;

  -- ── PASO 8: RETORNO ────────────────────────────────────────────────────────
  -- FIX BUG 1: usar to_jsonb() para convertir uuid[] → jsonb antes del COALESCE.
  -- ANTES (roto):  COALESCE(v_updated_ids, '[]'::jsonb)   ← mezcla uuid[] con jsonb
  -- AHORA (correcto): to_jsonb(COALESCE(v_updated_ids, '{}'::uuid[]))
  RETURN jsonb_build_object(
    'success',                true,
    'approved_request_id',    p_request_id,
    'updated_tx_ids',         to_jsonb(COALESCE(v_updated_ids, '{}'::uuid[])),
    'amount',                 v_req.amount,
    'student_id',             v_req.student_id,
    'school_id',              v_req.school_id,
    'payment_method',         v_req.payment_method,
    'billing_status_set',     COALESCE(v_billing_status, 'excluded'),
    'invoice_type',           v_req.invoice_type,
    'invoice_client_data',    v_req.invoice_client_data,
    'is_partial',             v_is_partial,
    'total_debt',             v_total_debt,
    'total_approved',         v_total_approved,
    'shortage',               GREATEST(0, v_total_debt - v_total_approved),
    'fifo_used',              v_needs_fifo,
    'balance_credit_applied', v_balance_credit,
    'kiosk_balance_restored', v_kiosk_paid_sum
  );

END;
$$;

GRANT EXECUTE ON FUNCTION process_traditional_voucher_approval(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION process_traditional_voucher_approval IS
  'v4 (2026-04-09): Fix crítico — COALESCE types uuid[] and jsonb cannot be matched. '
  'Se reemplaza COALESCE(v_updated_ids, ''[]''::jsonb) por '
  'to_jsonb(COALESCE(v_updated_ids, ''{}''::uuid[])) en el RETURN y en la auditoría. '
  'También se estandariza el uso de cardinality() en lugar de array_length() '
  'para consistencia con el manejo de arrays vacíos (array_length devuelve NULL para ''{}'').';
