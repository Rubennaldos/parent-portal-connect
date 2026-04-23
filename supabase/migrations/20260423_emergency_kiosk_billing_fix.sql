-- ============================================================================
-- REPARACIÓN DE EMERGENCIA — Lima Café 28
-- Fecha: 2026-04-23
--
-- BUG 1 (CRÍTICO — kiosco caído):
--   tg_enforce_spending_limit usa "s.weekly_spending_limit" que NO existe.
--   Las columnas reales en students son: daily_limit, weekly_limit,
--   monthly_limit, limit_type.
--   El hotfix del 22-04 introdujo la regresión con el nombre incorrecto.
--   TODA venta POS falla desde entonces.
--
-- BUG 2 (billing_queue — voucher no se puede reintentar):
--   process_traditional_voucher_approval hace un INSERT sin ON CONFLICT.
--   Si el proceso falla a mitad y se reintenta, el segundo INSERT explota
--   porque recharge_request_id ya existe en billing_queue.
--   Fix: UNIQUE parcial + ON CONFLICT DO UPDATE (idempotente).
--
-- ANÁLISIS DE CONSECUENCIAS (Regla #12):
--   Fix 1: solo reescribe la función del trigger con columnas correctas.
--          No altera la tabla students. No afecta RLS ni datos.
--   Fix 2: la constraint UNIQUE es parcial (WHERE NOT NULL), compatible con
--          pagos IziPay que usan recharge_request_id = NULL.
--          ON CONFLICT DO UPDATE reestablece status='pending' y emit_attempts=0
--          en cada reintento, garantizando exactamente un row por voucher.
--          El monto viene de v_req.amount (el voucher aprobado), no de
--          ningún cálculo frontend — cumple Regla de Oro #4.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: tg_enforce_spending_limit — columnas corregidas
-- ─────────────────────────────────────────────────────────────────────────────
-- CÓDIGO ELIMINADO (buggy):
--   SELECT s.kiosk_disabled, s.weekly_spending_limit, s.school_id   ← NO EXISTE
--   IF v_student.weekly_spending_limit IS NOT NULL AND ...           ← NO EXISTE
--   IF (v_weekly_spent + ABS(NEW.amount)) > v_student.weekly_spending_limit ...
--
-- CÓDIGO NUEVO: usa las columnas reales y verifica los 3 tipos de tope.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_enforce_spending_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_kiosk_disabled  boolean;
  v_limit_type      text;
  v_daily_limit     numeric;
  v_weekly_limit    numeric;
  v_monthly_limit   numeric;
  v_spent           numeric;
  v_period_start    timestamptz;
BEGIN
  -- Bypass: aprobaciones administrativas activan este flag
  IF current_setting('app.bypass_spending_limit', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Solo compras POS (kiosco)
  IF NEW.type <> 'purchase' THEN
    RETURN NEW;
  END IF;

  -- Solo transacciones nuevas con estado relevante
  IF NEW.payment_status NOT IN ('paid', 'pending') THEN
    RETURN NEW;
  END IF;

  -- Obtener configuración del alumno usando columnas REALES
  SELECT
    s.kiosk_disabled,
    COALESCE(s.limit_type, 'none'),
    COALESCE(s.daily_limit,   0),
    COALESCE(s.weekly_limit,  0),
    COALESCE(s.monthly_limit, 0)
  INTO
    v_kiosk_disabled,
    v_limit_type,
    v_daily_limit,
    v_weekly_limit,
    v_monthly_limit
  FROM public.students s
  WHERE s.id = NEW.student_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Bloqueo 1: kiosco desactivado
  IF v_kiosk_disabled = true THEN
    RAISE EXCEPTION 'KIOSK_DISABLED: El acceso al kiosco está desactivado para este alumno.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueo 2: tope diario
  IF v_limit_type = 'daily' AND v_daily_limit > 0 THEN
    v_period_start := date_trunc('day', NOW());
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_spent
    FROM   public.transactions t
    WHERE  t.student_id     = NEW.student_id
      AND  t.type           = 'purchase'
      AND  t.is_deleted     = false
      AND  t.payment_status = 'paid'
      AND  t.created_at    >= v_period_start;

    IF (v_spent + ABS(NEW.amount)) > v_daily_limit THEN
      RAISE EXCEPTION
        'DAILY_LIMIT_EXCEEDED: Límite diario S/ % (acumulado S/ %, compra S/ %).',
        v_daily_limit, v_spent, ABS(NEW.amount)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Bloqueo 3: tope semanal
  IF v_limit_type = 'weekly' AND v_weekly_limit > 0 THEN
    v_period_start := date_trunc('week', NOW());
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_spent
    FROM   public.transactions t
    WHERE  t.student_id     = NEW.student_id
      AND  t.type           = 'purchase'
      AND  t.is_deleted     = false
      AND  t.payment_status = 'paid'
      AND  t.created_at    >= v_period_start;

    IF (v_spent + ABS(NEW.amount)) > v_weekly_limit THEN
      RAISE EXCEPTION
        'WEEKLY_LIMIT_EXCEEDED: Límite semanal S/ % (acumulado S/ %, compra S/ %).',
        v_weekly_limit, v_spent, ABS(NEW.amount)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Bloqueo 4: tope mensual
  IF v_limit_type = 'monthly' AND v_monthly_limit > 0 THEN
    v_period_start := date_trunc('month', NOW());
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_spent
    FROM   public.transactions t
    WHERE  t.student_id     = NEW.student_id
      AND  t.type           = 'purchase'
      AND  t.is_deleted     = false
      AND  t.payment_status = 'paid'
      AND  t.created_at    >= v_period_start;

    IF (v_spent + ABS(NEW.amount)) > v_monthly_limit THEN
      RAISE EXCEPTION
        'MONTHLY_LIMIT_EXCEEDED: Límite mensual S/ % (acumulado S/ %, compra S/ %).',
        v_monthly_limit, v_spent, ABS(NEW.amount)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Recrear el trigger (la función ya existe, solo se asegura el binding)
DROP TRIGGER IF EXISTS trg_enforce_spending_limit ON public.transactions;
CREATE TRIGGER trg_enforce_spending_limit
BEFORE INSERT ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_spending_limit();

COMMENT ON FUNCTION public.tg_enforce_spending_limit() IS
  'v3 2026-04-23 EMERGENCY FIX: columnas corregidas (weekly_limit / daily_limit / monthly_limit). '
  'v2 usaba weekly_spending_limit (inexistente) → crash en TODAS las ventas POS. '
  'Bypass controlado vía set_config(''app.bypass_spending_limit'', ''on'') '
  'para aprobaciones administrativas.';

SELECT 'FIX 1 OK: tg_enforce_spending_limit v3 aplicado — columnas corregidas' AS resultado;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: billing_queue — idempotencia en reintento de facturación
-- ─────────────────────────────────────────────────────────────────────────────
-- PROBLEMA:
--   INSERT INTO billing_queue (...) VALUES (...) sin ON CONFLICT.
--   Si el proceso falla a mitad y se reintenta, el segundo INSERT crea un
--   segundo row con el mismo recharge_request_id → duplicate key si hay
--   unique constraint, O filas fantasma si no la hay (ambas causan errores).
--
-- SOLUCIÓN:
--   1. UNIQUE parcial (WHERE NOT NULL) sobre recharge_request_id.
--      La condición WHERE preserva la compatibilidad con pagos IziPay que
--      usan recharge_request_id = NULL.
--   2. ON CONFLICT DO UPDATE: en cada reintento, se restablece el row
--      al estado 'pending' listo para ser reprocesado.
--      El monto y el transaction_id se actualizan con los valores del
--      intento actual (idempotencia garantizada).
-- ─────────────────────────────────────────────────────────────────────────────

-- Unique parcial: solo una fila por voucher manual (recharge_request_id NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_queue_recharge_request
  ON public.billing_queue (recharge_request_id)
  WHERE recharge_request_id IS NOT NULL;

SELECT 'FIX 2 OK: unique index uq_billing_queue_recharge_request creado' AS resultado;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: process_traditional_voucher_approval — INSERT idempotente
-- ─────────────────────────────────────────────────────────────────────────────
-- Se aplica la misma lógica que ya existe para audit_billing_logs.
-- Se reemplaza SOLO el bloque del INSERT en billing_queue.
--
-- GARANTÍA DEL MONTO EXACTO:
--   amount = v_req.amount  (el monto original del voucher, campo en DB)
--   No hay cálculo frontend. No hay suma de arrays. Es el campo crudo del voucher.
--   Si el voucher dice S/ 12.00, la boleta dice S/ 12.00 — sin excepciones.
-- ─────────────────────────────────────────────────────────────────────────────

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
BEGIN
  -- Bypass: evitar que tg_enforce_spending_limit bloquee inserciones admin
  PERFORM set_config('app.bypass_spending_limit', 'on', true);

  SELECT rr.*, s.school_id
  INTO   v_req
  FROM   recharge_requests rr
  JOIN   students s ON s.id = rr.student_id
  WHERE  rr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitud no encontrada');
  END IF;

  -- ── Validaciones de seguridad ─────────────────────────────────────────────
  IF v_req.status NOT IN ('pending', 'approved') THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Estado inválido: %s', v_req.status));
  END IF;

  -- Idempotencia: si ya está aprobado Y tiene transacciones pagadas → devolver OK
  IF v_req.status = 'approved' THEN
    SELECT COUNT(*) > 0
    INTO   v_is_partial
    FROM   transactions t
    WHERE  t.student_id     = v_req.student_id
      AND  t.payment_status = 'paid'
      AND  (
        (v_req.paid_transaction_ids IS NOT NULL AND t.id = ANY(v_req.paid_transaction_ids))
        OR
        (v_req.lunch_order_ids IS NOT NULL AND (t.metadata->>'lunch_order_id')::uuid = ANY(v_req.lunch_order_ids))
      );

    IF v_is_partial THEN
      -- Ya fue aprobado y procesado: devolver OK sin re-ejecutar
      RETURN jsonb_build_object(
        'success',     true,
        'request_id',  p_request_id,
        'idempotent',  true,
        'message',     'Voucher ya procesado previamente'
      );
    END IF;
    -- status=approved pero sin transacciones pagadas → huérfano, continuar
  END IF;

  -- ── Arrays de IDs a procesar ─────────────────────────────────────────────
  v_lunch_ids := COALESCE(v_req.lunch_order_ids, ARRAY[]::uuid[]);
  v_tx_ids    := COALESCE(v_req.paid_transaction_ids, ARRAY[]::uuid[]);

  -- ── Actualizar recharge_request a 'approved' ─────────────────────────────
  IF v_req.status = 'pending' THEN
    UPDATE recharge_requests
    SET
      status      = 'approved',
      approved_by = p_admin_id,
      approved_at = NOW()
    WHERE id = p_request_id;
  END IF;

  -- ── Calcular deuda total ─────────────────────────────────────────────────
  IF array_length(v_lunch_ids, 1) > 0 THEN
    SELECT COALESCE(SUM(lo.price), 0)
    INTO   v_total_debt
    FROM   lunch_orders lo
    WHERE  lo.id = ANY(v_lunch_ids)
      AND  lo.payment_status IN ('pending', 'partial');
  END IF;

  IF array_length(v_tx_ids, 1) > 0 THEN
    SELECT v_total_debt + COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_total_debt
    FROM   transactions t
    WHERE  t.id = ANY(v_tx_ids)
      AND  t.payment_status = 'pending';
  END IF;

  -- ── Aplicar pago FIFO a almuerzos ────────────────────────────────────────
  IF array_length(v_lunch_ids, 1) > 0 THEN
    v_fifo_running := v_req.amount;

    FOR v_fifo_rec IN
      SELECT lo.id, lo.price
      FROM   lunch_orders lo
      WHERE  lo.id = ANY(v_lunch_ids)
        AND  lo.payment_status IN ('pending', 'partial')
      ORDER  BY lo.date ASC
    LOOP
      EXIT WHEN v_fifo_running <= 0;

      IF v_fifo_running >= v_fifo_rec.price THEN
        UPDATE lunch_orders
        SET payment_status = 'paid', paid_at = NOW()
        WHERE id = v_fifo_rec.id;
        v_fifo_running := v_fifo_running - v_fifo_rec.price;
      ELSE
        UPDATE lunch_orders
        SET payment_status = 'partial'
        WHERE id = v_fifo_rec.id;
        v_fifo_running := 0;
      END IF;

      v_fifo_ids := v_fifo_ids || v_fifo_rec.id;
    END LOOP;
  END IF;

  -- ── Marcar transactions como pagadas ─────────────────────────────────────
  IF array_length(v_tx_ids, 1) > 0 THEN
    WITH updated AS (
      UPDATE transactions t
      SET
        payment_status = 'paid',
        payment_method = v_req.payment_method,
        updated_at     = NOW()
      WHERE t.id          = ANY(v_tx_ids)
        AND t.student_id  = v_req.student_id
        AND t.payment_status = 'pending'
      RETURNING t.id
    )
    SELECT array_agg(id) INTO v_updated_ids FROM updated;
  END IF;

  -- Incluir IDs de almuerzos que generaron transacciones vinculadas
  IF array_length(v_fifo_ids, 1) > 0 THEN
    WITH lunch_txs AS (
      SELECT t.id
      FROM   transactions t
      WHERE  (t.metadata->>'lunch_order_id')::uuid = ANY(v_fifo_ids)
        AND  t.student_id = v_req.student_id
        AND  t.payment_status = 'paid'
    )
    SELECT COALESCE(v_updated_ids, ARRAY[]::uuid[]) || array_agg(id)
    INTO   v_updated_ids
    FROM   lunch_txs;
  END IF;

  -- ── fiscal_tx_id: primera tx para el PDF ─────────────────────────────────
  SELECT t.id
  INTO   v_fiscal_tx_id
  FROM   transactions t
  WHERE  t.student_id     = v_req.student_id
    AND  t.payment_status = 'paid'
    AND  (
      (v_tx_ids    IS NOT NULL AND t.id = ANY(v_tx_ids))
      OR
      (v_fifo_ids  IS NOT NULL AND (t.metadata->>'lunch_order_id')::uuid = ANY(v_fifo_ids))
    )
  ORDER  BY t.created_at DESC
  LIMIT  1;

  -- Fallback: transaction_id directo del voucher
  IF v_fiscal_tx_id IS NULL AND v_req.transaction_id IS NOT NULL THEN
    v_fiscal_tx_id := v_req.transaction_id;
  END IF;

  -- Vincular fiscal_tx_id al voucher para que el padre encuentre el PDF
  IF v_fiscal_tx_id IS NOT NULL THEN
    UPDATE recharge_requests
    SET    transaction_id = v_fiscal_tx_id
    WHERE  id             = p_request_id
      AND  (transaction_id IS DISTINCT FROM v_fiscal_tx_id);
  END IF;

  -- ── Calcular excedente → billetera ────────────────────────────────────────
  v_debt_applied_amount   := LEAST(v_req.amount, v_total_debt);
  v_recharge_surplus_amount := GREATEST(0, v_req.amount - v_total_debt);

  IF v_recharge_surplus_amount > 0.005 THEN
    -- El sobrante va a wallet_balance (no a una nueva recarga para simplificar)
    UPDATE students
    SET    wallet_balance = COALESCE(wallet_balance, 0) + v_recharge_surplus_amount
    WHERE  id = v_req.student_id;
    v_unified_payment_note := format('Sobrante S/ %s acreditado a billetera', v_recharge_surplus_amount);
  END IF;

  -- ── Billing queue: idempotente ────────────────────────────────────────────
  -- ON CONFLICT garantiza que un reintento no falle ni cree filas duplicadas.
  -- El monto es v_req.amount (el del voucher aprobado) — exacto, sin cálculos.
  IF v_req.invoice_type   IS NOT NULL
    AND v_req.invoice_client_data IS NOT NULL
    AND v_req.payment_method NOT IN ('efectivo', 'cash', 'saldo', 'pagar_luego', 'adjustment')
    AND NOT v_is_partial
  THEN
    INSERT INTO billing_queue (
      recharge_request_id,
      transaction_id,
      student_id,
      school_id,
      amount,
      invoice_type,
      invoice_client_data,
      status
    ) VALUES (
      p_request_id,
      v_fiscal_tx_id,
      v_req.student_id,
      v_req.school_id,
      v_req.amount,            -- monto exacto del voucher: S/ X.XX sin variaciones
      v_req.invoice_type,
      v_req.invoice_client_data,
      'pending'
    )
    ON CONFLICT (recharge_request_id)
    WHERE recharge_request_id IS NOT NULL
    DO UPDATE SET
      transaction_id      = EXCLUDED.transaction_id,
      amount              = EXCLUDED.amount,
      invoice_client_data = EXCLUDED.invoice_client_data,
      status              = 'pending',   -- resetear para que el worker lo reintente
      emit_attempts       = 0,
      error_message       = NULL,
      processed_at        = NULL
    RETURNING id INTO v_billing_queue_id;

    -- Si el row ya existía y fue actualizado, el RETURNING puede no devolver id.
    -- En ese caso, leer el id existente.
    IF v_billing_queue_id IS NULL THEN
      SELECT id INTO v_billing_queue_id
      FROM   billing_queue
      WHERE  recharge_request_id = p_request_id;
    END IF;
  END IF;

  -- ── audit_billing_logs: idempotente (protegido con WHERE NOT EXISTS) ──────
  BEGIN
    INSERT INTO audit_billing_logs (
      action_type,
      record_id,
      table_name,
      changed_by_user_id,
      school_id,
      new_data
    )
    SELECT
      'voucher_approved',
      p_request_id,
      'recharge_requests',
      p_admin_id,
      v_req.school_id,
      jsonb_build_object(
        'request_id',                  p_request_id,
        'student_id',                  v_req.student_id,
        'amount',                      v_req.amount,
        'request_type',                v_req.request_type,
        'approved_by',                 p_admin_id,
        'approved_at',                 NOW(),
        'tx_ids_updated',              v_updated_ids,
        'debt_applied_amount',         v_debt_applied_amount,
        'recharge_surplus_amount',     v_recharge_surplus_amount,
        'derived_recharge_request_id', v_generated_recharge_request_id,
        'unified_payment_note',        v_unified_payment_note,
        'billing_queue_id',            v_billing_queue_id,
        'fiscal_transaction_id',       v_fiscal_tx_id
      )
    WHERE NOT EXISTS (
      SELECT 1
      FROM   public.audit_billing_logs abl
      WHERE  abl.action_type = 'voucher_approved'
        AND  abl.table_name  = 'recharge_requests'
        AND  abl.record_id   = p_request_id
    );
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RETURN jsonb_build_object(
    'success',                       true,
    'request_id',                    p_request_id,
    'request_type',                  v_req.request_type,
    'amount',                        v_req.amount,
    'is_partial',                    v_is_partial,
    'updated_tx_count',              COALESCE(cardinality(v_updated_ids), 0),
    'updated_tx_ids',                v_updated_ids,
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
  'v8.0 2026-04-23 EMERGENCY FIX — '
  '(1) Reconstruida desde la v7.4 con el INSERT de billing_queue idempotente '
  '(ON CONFLICT recharge_request_id DO UPDATE). '
  '(2) Garantía de monto: amount = v_req.amount exacto, sin cálculos. '
  '(3) Sobrante va a wallet_balance sin RAISE EXCEPTION. '
  '(4) fiscal_tx_id vinculado a recharge_requests.transaction_id para el PDF del padre. '
  'Regla de Oro #12: robusto para reintento ilimitado.';

SELECT 'FIX 3 OK: process_traditional_voucher_approval v8.0 — billing_queue idempotente' AS resultado;
