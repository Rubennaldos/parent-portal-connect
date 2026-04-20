-- ============================================================================
-- MISIÓN FINAL: Trigger de partición atómica (REC-XXX)
-- Fecha: 2026-04-18
--
-- Objetivo:
--   Blindar la aprobación de pagos combinados (deuda + recarga) para que:
--   1) primero cubra deuda pendiente
--   2) el excedente se registre como recarga real (recharge_requests + transactions)
--   3) todo ocurra en una sola transacción atómica (all-or-nothing)
--
-- Fuente de verdad:
--   process_traditional_voucher_approval(uuid, uuid)
--
-- Nota:
--   En PostgreSQL, una función PL/pgSQL se ejecuta dentro de la transacción
--   del statement que la invoca. Si cualquier INSERT/UPDATE falla, se revierte
--   todo el flujo previo de la función automáticamente.
-- ============================================================================

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

  v_needs_fifo      boolean := false;
  v_fifo_rec        record;
  v_fifo_ids        uuid[]  := '{}';
  v_fifo_running    numeric := 0;
  v_balance_credit  numeric := 0;
  v_student_balance numeric := 0;

  v_explicit_kiosk_ids uuid[] := '{}';
  v_kiosk_paid_sum     numeric := 0;

  -- Split atómico (pago unificado)
  v_debt_applied_amount           numeric := 0;
  v_recharge_surplus_amount       numeric := 0;
  v_generated_recharge_request_id uuid    := null;
  v_unified_payment_note          text    := null;
  v_unified_ref_code              text    := null;
BEGIN
  -- ── PASO 1: CARGAR SOLICITUD ──────────────────────────────────────────────
  SELECT rr.*, s.school_id
  INTO   v_req
  FROM   recharge_requests rr
  JOIN   students s ON s.id = rr.student_id
  WHERE  rr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Solicitud % no existe', p_request_id;
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION
      'ALREADY_PROCESSED: La solicitud ya tiene estado "%". '
      'Otro administrador la procesó primero.',
      v_req.status;
  END IF;

  -- ── PASO 2: MARCAR SOLICITUD COMO APROBADA ───────────────────────────────
  UPDATE recharge_requests
  SET    status      = 'approved',
         approved_by = p_admin_id,
         approved_at = NOW()
  WHERE  id          = p_request_id;

  -- ── PASO 3: RECOPILAR IDs DE TRANSACCIONES A SALDAR ──────────────────────
  v_lunch_ids := COALESCE(v_req.lunch_order_ids, '{}');

  SELECT ARRAY_AGG(t.id ORDER BY t.created_at ASC)
  INTO   v_tx_ids
  FROM   transactions t
  WHERE  t.is_deleted    = false
    AND  t.payment_status IN ('pending', 'partial')
    AND  (
      (COALESCE(cardinality(v_req.paid_transaction_ids), 0) > 0
       AND t.id = ANY(v_req.paid_transaction_ids))
      OR
      (COALESCE(cardinality(v_lunch_ids), 0) > 0
       AND (t.metadata->>'lunch_order_id')::uuid = ANY(v_lunch_ids))
    );

  -- Fuente B: transacciones pendientes vinculadas a lunch_order_ids por metadata
  IF COALESCE(cardinality(v_lunch_ids), 0) > 0 THEN
    SELECT ARRAY_AGG(t.id ORDER BY t.created_at ASC)
    INTO   v_tx_ids
    FROM   transactions t
    WHERE  t.is_deleted    = false
      AND  t.payment_status IN ('pending', 'partial')
      AND  (
        (COALESCE(cardinality(v_req.paid_transaction_ids), 0) > 0
         AND t.id = ANY(v_req.paid_transaction_ids))
        OR
        (t.metadata->>'lunch_order_id')::uuid = ANY(v_lunch_ids)
      );
  END IF;

  -- FIFO para debt_payment sin IDs explícitos y sin lunch_order_ids
  IF v_req.request_type = 'debt_payment'
     AND COALESCE(cardinality(v_req.paid_transaction_ids), 0) = 0
     AND COALESCE(cardinality(v_lunch_ids), 0) = 0
  THEN
    v_needs_fifo := true;

    FOR v_fifo_rec IN
      SELECT t.id, ABS(t.amount) AS abs_amount
      FROM   transactions t
      WHERE  t.student_id    = v_req.student_id
        AND  t.is_deleted    = false
        AND  t.payment_status IN ('pending', 'partial')
        AND  t.metadata->>'lunch_order_id' IS NULL
      ORDER  BY t.created_at ASC
    LOOP
      EXIT WHEN v_fifo_running >= v_req.amount;
      v_fifo_ids    := v_fifo_ids    || v_fifo_rec.id;
      v_fifo_running := v_fifo_running + v_fifo_rec.abs_amount;
    END LOOP;

    v_tx_ids := COALESCE(v_tx_ids, '{}') || v_fifo_ids;
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
          'source_channel',      'parent_web',
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

    -- ── PASO 6b: RESTAURAR BALANCE — RUTA FIFO ──────────────────────────────
    IF v_needs_fifo AND v_balance_credit > 0 THEN
      INSERT INTO transactions (
        student_id, school_id, type, amount, description,
        payment_status, is_taxable, billing_status, created_by, metadata
      ) VALUES (
        v_req.student_id,
        v_req.school_id,
        'recharge',
        v_balance_credit,
        'Crédito por pago de deuda kiosco',
        'paid',
        false,
        'excluded',
        p_admin_id,
        jsonb_build_object(
          'source',               'debt_payment_kiosk_credit',
          'source_channel',       'parent_web',
          'recharge_request_id',  p_request_id::text,
          'is_kiosk_debt_credit', true,
          'approved_by',          p_admin_id::text,
          'approved_at',          to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'payment_method',       v_req.payment_method
        )
      );
    END IF;

    -- ── PASO 6c: RESTAURAR BALANCE — IDs EXPLÍCITOS DE KIOSCO ───────────────
    IF NOT v_needs_fifo AND COALESCE(cardinality(v_updated_ids), 0) > 0 THEN
      SELECT ARRAY_AGG(t.id)
      INTO   v_explicit_kiosk_ids
      FROM   transactions t
      WHERE  t.id = ANY(v_updated_ids)
        AND  (t.metadata->>'lunch_order_id') IS NULL;

      IF COALESCE(cardinality(v_explicit_kiosk_ids), 0) > 0 THEN
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
            INSERT INTO transactions (
              student_id, school_id, type, amount, description,
              payment_status, is_taxable, billing_status, created_by, metadata
            ) VALUES (
              v_req.student_id,
              v_req.school_id,
              'recharge',
              LEAST(v_kiosk_paid_sum, ABS(v_student_balance)),
              'Crédito por pago de deuda kiosco',
              'paid',
              false,
              'excluded',
              p_admin_id,
              jsonb_build_object(
                'source',               'debt_payment_kiosk_credit',
                'source_channel',       'parent_web',
                'recharge_request_id',  p_request_id::text,
                'is_kiosk_debt_credit', true,
                'approved_by',          p_admin_id::text,
                'approved_at',          to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'payment_method',       v_req.payment_method
              )
            );
          END IF;
        END IF;
      END IF;
    END IF;

    -- ── PASO 6d: PARTICIÓN ATÓMICA PAGO UNIFICADO (DEUDA + RECARGA) ─────────
    -- Aplica solo en debt_payment. Si el monto del voucher excede la deuda
    -- realmente saldada, el excedente se convierte en RECARGA formal.
    IF v_req.request_type = 'debt_payment' THEN
      SELECT COALESCE(SUM(ABS(t.amount)), 0)
      INTO   v_debt_applied_amount
      FROM   transactions t
      WHERE  t.id = ANY(COALESCE(v_updated_ids, '{}'::uuid[]));

      v_recharge_surplus_amount := GREATEST(0, v_req.amount - v_debt_applied_amount);

      IF v_recharge_surplus_amount > 0.009 THEN
        v_unified_payment_note := format(
          'Pago unificado: S/ %s deuda + S/ %s recarga',
          to_char(v_debt_applied_amount, 'FM999999990D00'),
          to_char(v_recharge_surplus_amount, 'FM999999990D00')
        );

        v_unified_ref_code := COALESCE(NULLIF(v_req.reference_code, ''), substr(replace(p_request_id::text, '-', ''), 1, 12)) || '-REC';

        -- Registro RECARGA formal para que el ledger FIFO genere REC-XXX
        INSERT INTO recharge_requests (
          student_id,
          parent_id,
          school_id,
          amount,
          payment_method,
          reference_code,
          voucher_url,
          notes,
          status,
          request_type,
          description,
          approved_by,
          approved_at
        ) VALUES (
          v_req.student_id,
          v_req.parent_id,
          v_req.school_id,
          v_recharge_surplus_amount,
          v_req.payment_method,
          v_unified_ref_code,
          v_req.voucher_url,
          v_unified_payment_note,
          'approved',
          'recharge',
          'Recarga derivada de pago unificado',
          p_admin_id,
          NOW()
        )
        RETURNING id INTO v_generated_recharge_request_id;

        -- Respaldo contable en transactions para sincronía de balance
        INSERT INTO transactions (
          student_id,
          school_id,
          type,
          amount,
          description,
          payment_status,
          payment_method,
          is_taxable,
          billing_status,
          created_by,
          metadata
        ) VALUES (
          v_req.student_id,
          v_req.school_id,
          'recharge',
          v_recharge_surplus_amount,
          'Recarga por excedente de pago unificado',
          'paid',
          v_req.payment_method,
          false,
          'excluded',
          p_admin_id,
          jsonb_build_object(
            'source',                         'unified_payment_surplus',
            'source_channel',                 'parent_web',
            'origin_debt_payment_request_id', p_request_id::text,
            'derived_recharge_request_id',    v_generated_recharge_request_id::text,
            'unified_payment_breakdown',      v_unified_payment_note,
            'approved_by',                    p_admin_id::text,
            'approved_at',                    to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          )
        );

        -- Escribir trazabilidad en transacciones de deuda ya pagadas
        IF COALESCE(cardinality(v_updated_ids), 0) > 0 THEN
          UPDATE transactions t
          SET metadata = COALESCE(t.metadata, '{}') || jsonb_build_object(
            'unified_payment',                true,
            'unified_payment_breakdown',      v_unified_payment_note,
            'derived_recharge_request_id',    v_generated_recharge_request_id::text
          )
          WHERE t.id = ANY(v_updated_ids);
        END IF;

        -- Escribir trazabilidad en la solicitud original de deuda
        UPDATE recharge_requests
        SET notes = trim(both ' ' from concat_ws(' | ', NULLIF(notes, ''), v_unified_payment_note))
        WHERE id = p_request_id;
      END IF;
    END IF;

  END IF;

  -- ── PASO 7: AUDITORÍA ─────────────────────────────────────────────────────
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
        'kiosk_balance_restored', v_kiosk_paid_sum,
        'debt_applied_amount',    v_debt_applied_amount,
        'recharge_surplus',       v_recharge_surplus_amount,
        'unified_payment_note',   v_unified_payment_note,
        'derived_recharge_req',   v_generated_recharge_request_id
      ),
      v_req.school_id,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Auditoría falló en process_traditional_voucher_approval: %', SQLERRM;
  END;

  -- ── PASO 8: RETORNO ───────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',                      true,
    'approved_request_id',          p_request_id,
    'updated_tx_ids',               to_jsonb(COALESCE(v_updated_ids, '{}'::uuid[])),
    'amount',                       v_req.amount,
    'student_id',                   v_req.student_id,
    'school_id',                    v_req.school_id,
    'payment_method',               v_req.payment_method,
    'billing_status_set',           COALESCE(v_billing_status, 'excluded'),
    'invoice_type',                 v_req.invoice_type,
    'invoice_client_data',          v_req.invoice_client_data,
    'is_partial',                   v_is_partial,
    'total_debt',                   v_total_debt,
    'total_approved',               v_total_approved,
    'shortage',                     GREATEST(0, v_total_debt - v_total_approved),
    'fifo_used',                    v_needs_fifo,
    'balance_credit_applied',       v_balance_credit,
    'kiosk_balance_restored',       v_kiosk_paid_sum,
    'debt_applied_amount',          v_debt_applied_amount,
    'recharge_surplus_amount',      v_recharge_surplus_amount,
    'derived_recharge_request_id',  v_generated_recharge_request_id,
    'unified_payment_note',         v_unified_payment_note
  );

END;
$$;

GRANT EXECUTE ON FUNCTION process_traditional_voucher_approval(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION process_traditional_voucher_approval IS
  'v7 (2026-04-18): Split atómico de pago unificado. Si debt_payment trae exceso, '
  'cubre deuda y crea recarga formal (recharge_requests + transactions) en la '
  'misma transacción. Guarda traza "Pago unificado: S/ X deuda + S/ Y recarga".';
