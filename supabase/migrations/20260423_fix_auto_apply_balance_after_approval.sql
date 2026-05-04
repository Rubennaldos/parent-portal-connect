-- ============================================================================
-- 2026-04-23 — Auto-aplicación de saldo a deudas pendientes tras aprobación
--
-- PROBLEMA RAÍZ:
--   Cuando el admin aprueba un voucher y hay un excedente (el pago > deuda),
--   la función crea una "Recarga derivada de pago unificado" que AGREGA SALDO
--   pero NO limpia las transacciones pendientes (T-AN-XXXXXX) del alumno.
--   Resultado: el padre ve deudas aunque el alumno ya tiene saldo positivo.
--
--   Casos afectados:
--   A) request_type = 'debt_payment' con excedente → crea recharge derivada
--      pero las compras pendientes que no estaban en paid_transaction_ids
--      (creadas DESPUÉS de que el padre envió el voucher) quedan sin saldar.
--   B) request_type = 'recharge' pura → saldo sube pero deudas permanecen.
--
-- SOLUCIÓN:
--   1. Nueva función fn_auto_apply_balance_to_pending_purchases:
--      - Obtiene el balance actual del alumno
--      - FIFO: recorre compras pendientes (+ antiguas primero)
--      - Marca como 'paid' cada compra que el saldo cubra
--      - También llama a fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval
--        para los almuerzos virtuales (Tramo 2) que tengan lunch_order_id
--      - Retorna los IDs de transacciones saldadas
--
--   2. process_traditional_voucher_approval v8.2:
--      - Al FINAL de su ejecución, llama a fn_auto_apply_balance_to_pending_purchases
--      - Aplica para 'recharge' Y para 'debt_payment' con excedente
--      - Los IDs saldados se agregan a paid_transaction_ids del recharge_request
--
-- GARANTÍAS:
--   - No toca fn_sync_student_balance (Regla 10: SSOT del balance)
--   - El trigger existente actualiza students.balance automáticamente
--   - Idempotente: si ya está pagada, el WHERE payment_status IN ('pending','partial')
--     la excluye
-- ============================================================================

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- A) Función auxiliar: auto-aplicar saldo a compras pendientes
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION public.fn_auto_apply_balance_to_pending_purchases(
  p_student_id         uuid,
  p_school_id          uuid,
  p_admin_id           uuid,
  p_source_request_id  uuid,
  p_payment_method     text DEFAULT 'saldo'
)
RETURNS uuid[]                  -- IDs de transacciones saldadas automáticamente
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance       numeric;
  v_tx            record;
  v_cleared_ids   uuid[] := '{}';
  v_lo_ids        uuid[] := '{}';
BEGIN
  -- Obtener balance ACTUAL del alumno (post-trigger si fue modificado por la aprobación)
  SELECT balance INTO v_balance
  FROM public.students
  WHERE id = p_student_id;

  IF COALESCE(v_balance, 0) <= 0 THEN
    RETURN v_cleared_ids;  -- Sin saldo disponible, nada que aplicar
  END IF;

  -- FIFO: recorrer todas las compras pendientes del alumno (más antiguas primero)
  FOR v_tx IN
    SELECT t.id,
           ABS(t.amount)::numeric(10,2) AS abs_amount,
           t.metadata->>'lunch_order_id' AS lunch_order_id
    FROM   public.transactions t
    WHERE  t.student_id    = p_student_id
      AND  t.is_deleted    = false
      AND  t.type          = 'purchase'
      AND  t.payment_status IN ('pending', 'partial')
    ORDER  BY t.created_at ASC
  LOOP
    -- Refrescar balance en cada iteración (el trigger puede haberlo cambiado)
    SELECT balance INTO v_balance FROM public.students WHERE id = p_student_id;
    EXIT WHEN COALESCE(v_balance, 0) <= 0;
    EXIT WHEN COALESCE(v_balance, 0) < v_tx.abs_amount * 0.99; -- Margen de centavos

    -- Marcar como pagada
    UPDATE public.transactions t
    SET
      payment_status = 'paid',
      payment_method = COALESCE(NULLIF(TRIM(p_payment_method), ''), 'saldo'),
      metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
        'payment_approved',            true,
        'auto_applied_from_balance',   true,
        'source_recharge_request_id',  p_source_request_id::text,
        'approved_by',                 p_admin_id::text,
        'approved_at',                 to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    WHERE t.id            = v_tx.id
      AND t.is_deleted    = false
      AND t.payment_status IN ('pending', 'partial');

    v_cleared_ids := v_cleared_ids || v_tx.id;

    -- Si tiene lunch_order_id, también actualizarlo en lunch_orders
    IF v_tx.lunch_order_id IS NOT NULL THEN
      v_lo_ids := v_lo_ids || v_tx.lunch_order_id::uuid;

      UPDATE public.lunch_orders
      SET    status = 'confirmed'
      WHERE  id          = v_tx.lunch_order_id::uuid
        AND  is_cancelled = false
        AND  status      <> 'cancelled';
    END IF;
  END LOOP;

  -- Para almuerzos virtuales (Tramo 2): crear el mirror si el lunch_order
  -- no tiene ninguna transacción todavía (evita que sigan en la vista).
  -- Solo si tenemos un request_id válido (no NULL) para el audit trail.
  IF cardinality(v_lo_ids) > 0 AND p_source_request_id IS NOT NULL THEN
    PERFORM public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
      p_source_request_id,
      p_student_id,
      p_school_id,
      v_lo_ids,
      p_payment_method,
      p_admin_id,
      NULL,   -- voucher_url
      NULL,   -- reference_code
      'recharge',
      false,
      'excluded'
    );
  END IF;

  RETURN v_cleared_ids;
END;
$$;

COMMENT ON FUNCTION public.fn_auto_apply_balance_to_pending_purchases(uuid, uuid, uuid, uuid, text)
IS '2026-04-23 — Auto-aplica saldo positivo del alumno a sus compras pendientes (FIFO). '
   'Llamar DESPUÉS de que fn_sync_student_balance haya actualizado students.balance. '
   'No crea triggers de balance (Regla 10). Retorna UUIDs de transacciones saldadas.';

SELECT 'fn_auto_apply_balance_to_pending_purchases creada OK' AS paso_a;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- B) process_traditional_voucher_approval v8.2
--    Único cambio vs v8.1: llama a fn_auto_apply_balance_to_pending_purchases
--    al FINAL, después de todo el procesamiento.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION public.process_traditional_voucher_approval(
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
  v_fiscal_tx_id    uuid := null;
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

  v_debt_applied_amount           numeric := 0;
  v_recharge_surplus_amount       numeric := 0;
  v_generated_recharge_request_id uuid    := null;
  v_credit_tx_id                  uuid    := null;
  v_surplus_tx_id                 uuid    := null;
  v_unified_payment_note          text    := null;
  v_unified_ref_code              text    := null;

  v_billing_queue_id              uuid    := null;

  -- v8.2: IDs saldados por auto-aplicación de saldo
  v_auto_applied_ids              uuid[]  := '{}';
BEGIN
  PERFORM set_config('app.bypass_spending_limit', 'on', true);

  SELECT rr.*, s.school_id
  INTO   v_req
  FROM   recharge_requests rr
  JOIN   students s ON s.id = rr.student_id
  WHERE  rr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Solicitud % no existe', p_request_id;
  END IF;

  IF v_req.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION
      'ALREADY_PROCESSED: La solicitud ya tiene estado "%". '
      'Otro administrador la procesó primero.',
      v_req.status;
  END IF;

  IF v_req.status = 'approved' THEN
    IF EXISTS (
      SELECT 1
      FROM   public.transactions t
      WHERE  t.is_deleted     = false
        AND  t.payment_status = 'paid'
        AND  t.type           = 'purchase'
        AND  (
          (t.metadata->>'recharge_request_id') = p_request_id::text
          OR
          (COALESCE(cardinality(v_req.paid_transaction_ids), 0) > 0
           AND t.id = ANY(v_req.paid_transaction_ids))
        )
      LIMIT 1
    ) THEN
      RETURN jsonb_build_object(
        'success',         true,
        'request_id',      p_request_id,
        'already_complete', true,
        'message',         'Pago ya procesado correctamente en un paso anterior.'
      );
    END IF;
  ELSE
    UPDATE recharge_requests
    SET    status      = 'approved',
           approved_by = p_admin_id,
           approved_at = NOW()
    WHERE  id          = p_request_id;
  END IF;

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

  IF COALESCE(cardinality(v_tx_ids), 0) = 0
     AND COALESCE(cardinality(v_lunch_ids), 0) = 0
  THEN
    SELECT balance INTO v_student_balance
    FROM   students
    WHERE  id = v_req.student_id;

    IF COALESCE(v_student_balance, 0) >= 0 THEN
      v_balance_credit := v_req.amount;
    END IF;
  ELSIF COALESCE(cardinality(v_tx_ids), 0) = 0
     AND COALESCE(cardinality(v_lunch_ids), 0) > 0
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM   lunch_orders lo
      WHERE  lo.id = ANY(v_lunch_ids)
        AND  lo.is_cancelled = false
        AND  lo.status NOT IN ('cancelled')
    ) THEN
      v_balance_credit := v_req.amount;
    END IF;
  END IF;

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

    IF COALESCE(cardinality(v_lunch_ids), 0) > 0 THEN
      PERFORM public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
        p_request_id,
        v_req.student_id,
        v_req.school_id,
        v_lunch_ids,
        v_req.payment_method,
        p_admin_id,
        v_req.voucher_url,
        v_req.reference_code,
        v_req.request_type,
        v_is_taxable,
        v_billing_status
      );
    END IF;

    SELECT coalesce(array_agg(s.id), '{}'::uuid[]) INTO v_updated_ids
    FROM (
      SELECT DISTINCT t.id
      FROM   public.transactions t
      WHERE  t.is_deleted     = false
        AND  t.payment_status  = 'paid'
        AND  t.type            = 'purchase'
        AND  (
          (COALESCE(cardinality(v_tx_ids), 0) > 0 AND t.id = ANY(v_tx_ids))
          OR
          (t.metadata->>'recharge_request_id' = p_request_id::text)
        )
    ) s;

    IF COALESCE(cardinality(v_lunch_ids), 0) > 0 THEN
      UPDATE public.transactions t
      SET
        student_id = v_req.student_id,
        school_id  = COALESCE(t.school_id, v_req.school_id)
      WHERE t.is_deleted     = false
        AND t.type           = 'purchase'
        AND t.payment_status = 'paid'
        AND t.student_id IS NULL
        AND (t.metadata->>'recharge_request_id') = p_request_id::text
        AND t.metadata->>'lunch_order_id' IS NOT NULL
        AND (t.metadata->>'lunch_order_id')::uuid = ANY(v_lunch_ids);
    END IF;

    SELECT t.id
    INTO   v_fiscal_tx_id
    FROM   public.transactions t
    WHERE  t.is_deleted     = false
      AND  t.type           = 'purchase'
      AND  t.payment_status = 'paid'
      AND  t.student_id     = v_req.student_id
      AND (
        (COALESCE(cardinality(v_updated_ids), 0) > 0 AND t.id = ANY(v_updated_ids))
        OR
        ((t.metadata->>'recharge_request_id') = p_request_id::text)
      )
    ORDER  BY ABS(t.amount) DESC, t.created_at ASC
    LIMIT  1;

    IF v_fiscal_tx_id IS NULL AND v_req.transaction_id IS NOT NULL THEN
      v_fiscal_tx_id := v_req.transaction_id;
    END IF;

    IF v_fiscal_tx_id IS NOT NULL
       AND (
         COALESCE(cardinality(v_req.paid_transaction_ids), 0) > 0
         OR COALESCE(cardinality(v_lunch_ids), 0) > 0
       )
    THEN
      UPDATE public.recharge_requests
      SET    transaction_id = v_fiscal_tx_id
      WHERE  id = p_request_id
        AND  (transaction_id IS DISTINCT FROM v_fiscal_tx_id);
    END IF;

    IF COALESCE(cardinality(v_lunch_ids), 0) > 0 THEN
      UPDATE lunch_orders
      SET    status = 'confirmed'
      WHERE  id          = ANY(v_lunch_ids)
        AND  is_cancelled = false
        AND  status      <> 'cancelled';
    END IF;

    IF COALESCE(cardinality(v_updated_ids), 0) > 0 THEN
      UPDATE public.recharge_requests rr
      SET    paid_transaction_ids = (
        SELECT array_agg(DISTINCT x)
        FROM   unnest(COALESCE(rr.paid_transaction_ids, '{}'::uuid[]) || v_updated_ids) AS x
      )
      WHERE rr.id = p_request_id;
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

    IF v_needs_fifo AND v_balance_credit > 0 THEN
      INSERT INTO transactions (
        student_id, school_id, type, amount, description,
        payment_status, is_taxable, billing_status, created_by, metadata
      ) VALUES (
        v_req.student_id, v_req.school_id, 'recharge', v_balance_credit,
        'Crédito por pago de deuda kiosco', 'paid', false, 'excluded', p_admin_id,
        jsonb_build_object(
          'source',               'debt_payment_kiosk_credit',
          'source_channel',       'parent_web',
          'recharge_request_id',  p_request_id::text,
          'is_kiosk_debt_credit', true,
          'approved_by',          p_admin_id::text,
          'approved_at',          to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'payment_method',       v_req.payment_method
        )
      )
      RETURNING id INTO v_credit_tx_id;

      UPDATE public.recharge_requests rr
      SET    paid_transaction_ids = (
        SELECT array_agg(DISTINCT x)
        FROM   unnest(COALESCE(rr.paid_transaction_ids, '{}'::uuid[]) || ARRAY[v_credit_tx_id]) AS x
      )
      WHERE rr.id = p_request_id;
    END IF;

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
          SELECT balance INTO v_student_balance FROM students WHERE id = v_req.student_id;

          IF COALESCE(v_student_balance, 0) < 0 THEN
            INSERT INTO transactions (
              student_id, school_id, type, amount, description,
              payment_status, is_taxable, billing_status, created_by, metadata
            ) VALUES (
              v_req.student_id, v_req.school_id, 'recharge',
              LEAST(v_kiosk_paid_sum, ABS(v_student_balance)),
              'Crédito por pago de deuda kiosco', 'paid', false, 'excluded', p_admin_id,
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

        INSERT INTO recharge_requests (
          student_id, parent_id, school_id, amount, payment_method,
          reference_code, voucher_url, notes, status, request_type,
          description, approved_by, approved_at
        ) VALUES (
          v_req.student_id, v_req.parent_id, v_req.school_id, v_recharge_surplus_amount,
          v_req.payment_method, v_unified_ref_code, v_req.voucher_url,
          v_unified_payment_note, 'approved', 'recharge',
          'Recarga derivada de pago unificado', p_admin_id, NOW()
        )
        RETURNING id INTO v_generated_recharge_request_id;

        INSERT INTO transactions (
          student_id, school_id, type, amount, description, payment_status,
          payment_method, is_taxable, billing_status, created_by, metadata
        ) VALUES (
          v_req.student_id, v_req.school_id, 'recharge', v_recharge_surplus_amount,
          'Recarga por excedente de pago unificado', 'paid', v_req.payment_method,
          false, 'excluded', p_admin_id,
          jsonb_build_object(
            'source', 'unified_payment_surplus', 'source_channel', 'parent_web',
            'origin_debt_payment_request_id', p_request_id::text,
            'derived_recharge_request_id', v_generated_recharge_request_id::text,
            'unified_payment_breakdown', v_unified_payment_note,
            'approved_by', p_admin_id::text,
            'approved_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          )
        )
        RETURNING id INTO v_surplus_tx_id;

        UPDATE public.recharge_requests rr
        SET    paid_transaction_ids = (
          SELECT array_agg(DISTINCT x)
          FROM   unnest(COALESCE(rr.paid_transaction_ids, '{}'::uuid[]) || ARRAY[v_surplus_tx_id]) AS x
        )
        WHERE rr.id = p_request_id;

        IF COALESCE(cardinality(v_updated_ids), 0) > 0 THEN
          UPDATE transactions t
          SET metadata = COALESCE(t.metadata, '{}') || jsonb_build_object(
            'unified_payment', true,
            'unified_payment_breakdown', v_unified_payment_note,
            'derived_recharge_request_id', v_generated_recharge_request_id::text
          )
          WHERE t.id = ANY(v_updated_ids);
        END IF;

        UPDATE recharge_requests
        SET notes = trim(both ' ' from concat_ws(' | ', NULLIF(notes, ''), v_unified_payment_note))
        WHERE id = p_request_id;
      END IF;
    END IF;

  END IF;

  -- ── v8.2: Auto-aplicar saldo restante a deudas pendientes ─────────────────
  -- Después de todo el procesamiento (deudas explícitas + excedente),
  -- si el alumno tiene saldo positivo y aún hay compras pendientes,
  -- aplicar FIFO automáticamente.
  -- Cubre: recharge pura, debt_payment con excedente, y cualquier pago
  -- cuyo monto superó la deuda original.
  v_auto_applied_ids := public.fn_auto_apply_balance_to_pending_purchases(
    v_req.student_id,
    v_req.school_id,
    p_admin_id,
    p_request_id,
    v_req.payment_method
  );

  IF COALESCE(cardinality(v_auto_applied_ids), 0) > 0 THEN
    -- Registrar los IDs auto-aplicados en el recharge_request original
    UPDATE public.recharge_requests rr
    SET    paid_transaction_ids = (
      SELECT array_agg(DISTINCT x)
      FROM   unnest(COALESCE(rr.paid_transaction_ids, '{}'::uuid[]) || v_auto_applied_ids) AS x
    )
    WHERE rr.id = p_request_id;

    -- Unir con v_updated_ids para el resultado final
    v_updated_ids := COALESCE(v_updated_ids, '{}') || v_auto_applied_ids;
  END IF;

  -- ── billing_queue (v8.1: ON CONFLICT idempotente) ─────────────────────────
  IF v_req.invoice_type        IS NOT NULL
    AND v_req.invoice_client_data IS NOT NULL
    AND v_req.payment_method NOT IN ('efectivo', 'cash', 'saldo', 'pagar_luego', 'adjustment')
    AND NOT v_is_partial
  THEN
    INSERT INTO billing_queue (
      recharge_request_id, transaction_id, student_id, school_id,
      amount, invoice_type, invoice_client_data, status
    ) VALUES (
      p_request_id, v_fiscal_tx_id, v_req.student_id, v_req.school_id,
      v_req.amount, v_req.invoice_type, v_req.invoice_client_data, 'pending'
    )
    ON CONFLICT (recharge_request_id)
    WHERE recharge_request_id IS NOT NULL
    DO UPDATE SET
      transaction_id      = EXCLUDED.transaction_id,
      amount              = EXCLUDED.amount,
      invoice_client_data = EXCLUDED.invoice_client_data,
      status              = 'pending',
      emit_attempts       = 0,
      error_message       = NULL,
      processed_at        = NULL
    RETURNING id INTO v_billing_queue_id;

    IF v_billing_queue_id IS NULL THEN
      SELECT id INTO v_billing_queue_id FROM billing_queue WHERE recharge_request_id = p_request_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO audit_billing_logs (
      action_type, record_id, table_name, changed_by_user_id, school_id, new_data
    )
    SELECT
      'voucher_approved', p_request_id, 'recharge_requests', p_admin_id,
      v_req.school_id,
      jsonb_build_object(
        'request_id',                  p_request_id,
        'student_id',                  v_req.student_id,
        'amount',                      v_req.amount,
        'request_type',                v_req.request_type,
        'approved_by',                 p_admin_id,
        'approved_at',                 NOW(),
        'tx_ids_updated',              v_updated_ids,
        'auto_applied_ids',            v_auto_applied_ids,
        'debt_applied_amount',         v_debt_applied_amount,
        'recharge_surplus_amount',     v_recharge_surplus_amount,
        'derived_recharge_request_id', v_generated_recharge_request_id,
        'unified_payment_note',        v_unified_payment_note,
        'billing_queue_id',            v_billing_queue_id,
        'fiscal_transaction_id',       v_fiscal_tx_id
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_billing_logs abl
      WHERE  abl.action_type = 'voucher_approved'
        AND  abl.table_name  = 'recharge_requests'
        AND  abl.record_id   = p_request_id
    );
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RETURN jsonb_build_object(
    'success',                       true,
    'request_id',                    p_request_id,
    'request_type',                  v_req.request_type,
    'amount',                        v_req.amount,
    'is_partial',                    v_is_partial,
    'updated_tx_count',              COALESCE(cardinality(v_updated_ids), 0),
    'updated_tx_ids',                v_updated_ids,
    'auto_applied_ids',              v_auto_applied_ids,
    'debt_applied_amount',           v_debt_applied_amount,
    'recharge_surplus_amount',       v_recharge_surplus_amount,
    'derived_recharge_request_id',   v_generated_recharge_request_id,
    'unified_payment_note',          v_unified_payment_note,
    'billing_queue_id',              v_billing_queue_id,
    'fiscal_transaction_id',         v_fiscal_tx_id
  );

END;
$$;

COMMENT ON FUNCTION public.process_traditional_voucher_approval(uuid, uuid) IS
  'v8.2 2026-04-23 — Agrega llamada a fn_auto_apply_balance_to_pending_purchases '
  'al FINAL del procesamiento. Cubre: recharge pura, debt_payment con excedente, '
  'y transacciones creadas DESPUÉS de que el padre enviara el voucher. '
  'Todos los demás flujos son idénticos a v8.1.';

SELECT 'v8.2 OK: process_traditional_voucher_approval con auto-apply de saldo' AS resultado_final;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- C) LIMPIEZA DE DATOS EXISTENTES
--    Corrige los casos ya creados: alumnos con saldo positivo Y compras pendientes.
--    Esto salda las deudas que quedaron huérfanas de pagos anteriores.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
  v_student        record;
  v_tx             record;
  v_balance        numeric;
  v_sys_admin_id   uuid;
  v_cleared_count  int := 0;
  v_total_count    int := 0;
BEGIN
  -- Obtener un superadmin para el audit trail de la limpieza
  SELECT id INTO v_sys_admin_id
  FROM   public.profiles
  WHERE  role IN ('superadmin', 'admin_general')
  LIMIT  1;

  -- Recorrer todos los alumnos con saldo positivo Y deudas pendientes
  FOR v_student IN
    SELECT DISTINCT s.id AS student_id, s.balance, s.school_id
    FROM   public.students s
    WHERE  COALESCE(s.balance, 0) > 0
      AND  EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE  t.student_id    = s.id
          AND  t.is_deleted    = false
          AND  t.type          = 'purchase'
          AND  t.payment_status IN ('pending', 'partial')
      )
    ORDER  BY s.id
  LOOP
    v_cleared_count := 0;
    v_balance       := v_student.balance;

    -- FIFO: saldar compras pendientes con el saldo disponible
    FOR v_tx IN
      SELECT t.id,
             ABS(t.amount)::numeric(10,2)       AS abs_amount,
             t.metadata->>'lunch_order_id'       AS lunch_order_id
      FROM   public.transactions t
      WHERE  t.student_id    = v_student.student_id
        AND  t.is_deleted    = false
        AND  t.type          = 'purchase'
        AND  t.payment_status IN ('pending', 'partial')
      ORDER  BY t.created_at ASC
    LOOP
      -- Refrescar el balance real después de cada update (trigger ya corrió)
      SELECT balance INTO v_balance FROM public.students WHERE id = v_student.student_id;
      EXIT WHEN COALESCE(v_balance, 0) <= 0;
      EXIT WHEN COALESCE(v_balance, 0) < v_tx.abs_amount * 0.99;

      UPDATE public.transactions t
      SET
        payment_status = 'paid',
        payment_method = COALESCE(NULLIF(t.payment_method, ''), 'saldo'),
        metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
          'payment_approved',          true,
          'auto_applied_from_balance', true,
          'cleanup_migration',         '20260423_fix_auto_apply_balance',
          'approved_by',               COALESCE(v_sys_admin_id::text, 'system'),
          'approved_at',               to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
      WHERE t.id            = v_tx.id
        AND t.is_deleted    = false
        AND t.payment_status IN ('pending', 'partial');

      -- Actualizar el lunch_order si aplica
      IF v_tx.lunch_order_id IS NOT NULL THEN
        UPDATE public.lunch_orders
        SET    status = 'confirmed'
        WHERE  id          = v_tx.lunch_order_id::uuid
          AND  is_cancelled = false
          AND  status      <> 'cancelled';
      END IF;

      v_cleared_count := v_cleared_count + 1;
    END LOOP;

    IF v_cleared_count > 0 THEN
      v_total_count := v_total_count + v_cleared_count;
      RAISE NOTICE 'Alumno % — % compra(s) saldada(s) con balance S/%',
        v_student.student_id, v_cleared_count, v_student.balance;
    END IF;
  END LOOP;

  RAISE NOTICE '=== LIMPIEZA COMPLETADA: % transacción(es) saldada(s) en total ===', v_total_count;
END $$;

SELECT 'LIMPIEZA OK: deudas huérfanas saldadas con saldo disponible' AS paso_c;
