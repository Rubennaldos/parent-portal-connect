-- ============================================================================
-- ARQUISIA PRO — Integridad de Pagos y Cola de Facturación Electrónica
-- Fecha: 2026-04-18
--
-- Este script instala 3 piezas que trabajan juntas:
--
-- PIEZA 1 — Trigger anti-doble-pago (tg_block_duplicate_debt_payment)
--   Bloquea INSERT de recharge_requests si los paid_transaction_ids o
--   lunch_order_ids ya están cubiertos por un voucher 'pending' del mismo padre.
--   Lanza: 'DUPLICATE_PAYMENT: ...' → el hook classifyAndShowError lo maneja.
--
-- PIEZA 2 — Tabla billing_queue
--   Cola de facturación electrónica.  Cada fila es una solicitud de emitir
--   boleta/factura para un pago aprobado que trajo invoice_client_data.
--   Procesada por cron/worker externo (ej. Edge Function de Supabase).
--
-- PIEZA 3 — process_traditional_voucher_approval v7.1
--   Añade detección de invoice_client_data al final del flujo de aprobación:
--   si el voucher trae datos tributarios, inserta en billing_queue.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 1: Trigger anti-doble-pago
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_block_duplicate_debt_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo aplica a nuevos pendientes de tipo deuda/almuerzo
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.request_type NOT IN ('debt_payment', 'lunch_payment') THEN
    RETURN NEW;
  END IF;

  -- ── BLOQUEO 1: paid_transaction_ids con overlap ────────────────────────
  IF COALESCE(cardinality(NEW.paid_transaction_ids), 0) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM   public.recharge_requests rr
      WHERE  rr.student_id             = NEW.student_id
        AND  rr.status                 = 'pending'
        AND  rr.request_type           IN ('debt_payment', 'lunch_payment')
        AND  rr.paid_transaction_ids  IS NOT NULL
        AND  rr.paid_transaction_ids  && NEW.paid_transaction_ids   -- overlap &&
    ) THEN
      RAISE EXCEPTION
        'DUPLICATE_PAYMENT: Ya existe un comprobante en revisión que cubre '
        'una o más de las mismas transacciones. '
        'Espera que sea aprobado o rechazado antes de enviar otro comprobante.';
    END IF;
  END IF;

  -- ── BLOQUEO 2: lunch_order_ids con overlap ─────────────────────────────
  IF COALESCE(cardinality(NEW.lunch_order_ids), 0) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM   public.recharge_requests rr
      WHERE  rr.student_id            = NEW.student_id
        AND  rr.status                = 'pending'
        AND  rr.request_type          IN ('debt_payment', 'lunch_payment')
        AND  rr.lunch_order_ids      IS NOT NULL
        AND  rr.lunch_order_ids      && NEW.lunch_order_ids         -- overlap &&
    ) THEN
      RAISE EXCEPTION
        'DUPLICATE_PAYMENT: Ya existe un comprobante en revisión para '
        'uno o más de los mismos almuerzos. '
        'Espera que sea aprobado o rechazado antes de enviar otro.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_block_duplicate_debt_payment() IS
  'Trigger BEFORE INSERT en recharge_requests. Bloquea doble pago para las '
  'mismas transacciones o almuerzos. Lanza DUPLICATE_PAYMENT si ya hay un '
  'voucher pending que solapa los mismos IDs. Indestructible: vive en DB, '
  'no puede ser eludido desde el frontend.';

-- Idempotente: DROP + CREATE para poder re-aplicar en CI
DROP TRIGGER IF EXISTS tg_block_duplicate_debt_payment ON public.recharge_requests;

CREATE TRIGGER tg_block_duplicate_debt_payment
  BEFORE INSERT
  ON     public.recharge_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_duplicate_debt_payment();

COMMENT ON TRIGGER tg_block_duplicate_debt_payment ON public.recharge_requests IS
  'Muralla Final (Regla #11.B): ningún código, ningún admin y ningún padre '
  'puede crear un pago duplicado para las mismas deudas. Todo-o-nada.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 2: Tabla billing_queue
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.billing_queue (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  recharge_request_id  uuid        NOT NULL REFERENCES public.recharge_requests(id) ON DELETE CASCADE,
  student_id           uuid        NOT NULL REFERENCES public.students(id)           ON DELETE CASCADE,
  school_id            uuid        REFERENCES public.schools(id)                     ON DELETE SET NULL,
  amount               numeric(10,2) NOT NULL CHECK (amount > 0),
  invoice_type         text        NOT NULL CHECK (invoice_type IN ('boleta', 'factura')),
  invoice_client_data  jsonb,       -- { dni_ruc, name, email, address }
  status               text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'processing', 'emitted', 'failed', 'cancelled')),
  created_at           timestamptz NOT NULL DEFAULT NOW(),
  processed_at         timestamptz,
  error_message        text,
  emit_attempts        int         NOT NULL DEFAULT 0,
  -- Datos de la factura emitida (llenados por el worker al completar)
  nubefact_ticket      text,
  pdf_url              text,
  sunat_status         text
);

COMMENT ON TABLE public.billing_queue IS
  'Cola FIFO de solicitudes de facturación electrónica (boleta/factura). '
  'Cada fila se crea automáticamente al aprobar un voucher que trae invoice_client_data. '
  'Un worker externo (Edge Function o cron) procesa las filas ''pending'' '
  'y actualiza status a ''emitted'' o ''failed''.';

-- Índices operacionales
CREATE INDEX IF NOT EXISTS idx_billing_queue_status_created
  ON public.billing_queue (status, created_at ASC)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_billing_queue_request
  ON public.billing_queue (recharge_request_id);

CREATE INDEX IF NOT EXISTS idx_billing_queue_student
  ON public.billing_queue (student_id);

-- RLS: solo admin puede ver/modificar la cola; el padre NO
ALTER TABLE public.billing_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_queue_admin_all   ON public.billing_queue;
DROP POLICY IF EXISTS billing_queue_parent_none ON public.billing_queue;

CREATE POLICY billing_queue_admin_all ON public.billing_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 3: process_traditional_voucher_approval v7.1
--   Solo añade la cola de facturación al final del flujo existente v7.
--   NO modifica la lógica de deuda/recarga/FIFO.
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

  -- Cola de facturación
  v_billing_queue_id              uuid    := null;
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
        );

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

  END IF; -- fin NOT v_is_partial

  -- ── PASO 7: COLA DE FACTURACIÓN ELECTRÓNICA (v7.1 — nuevo) ───────────────
  -- Si el voucher viene con datos tributarios (invoice_client_data) y un tipo
  -- de comprobante (boleta o factura), se encola para emisión automática.
  -- Solo aplica a pagos con método electrónico (no efectivo ni saldo).
  IF v_req.invoice_type   IS NOT NULL
    AND v_req.invoice_client_data IS NOT NULL
    AND v_req.payment_method NOT IN ('efectivo', 'cash', 'saldo', 'pagar_luego', 'adjustment')
    AND NOT v_is_partial
  THEN
    INSERT INTO billing_queue (
      recharge_request_id,
      student_id,
      school_id,
      amount,
      invoice_type,
      invoice_client_data,
      status
    ) VALUES (
      p_request_id,
      v_req.student_id,
      v_req.school_id,
      v_req.amount,
      v_req.invoice_type,
      v_req.invoice_client_data,
      'pending'
    )
    RETURNING id INTO v_billing_queue_id;
  END IF;

  -- ── PASO 8: AUDITORÍA ─────────────────────────────────────────────────────
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
      'billing_queue_id',            v_billing_queue_id
    );

  -- ── RETORNO ───────────────────────────────────────────────────────────────
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
    'billing_queue_id',              v_billing_queue_id
  );

END;
$$;

COMMENT ON FUNCTION public.process_traditional_voucher_approval(uuid, uuid) IS
  'v7.1 2026-04-18 — Aprobación atómica de vouchers de pago. '
  'Incluye: '
  '(1) FOR UPDATE anti-race; '
  '(2) guarda ALREADY_PROCESSED; '
  '(3) actualiza transactions + lunch_orders; '
  '(4) restaura balance (FIFO o explícito); '
  '(5) split atómico deuda+recarga; '
  '(6) encola en billing_queue si hay invoice_client_data.';
