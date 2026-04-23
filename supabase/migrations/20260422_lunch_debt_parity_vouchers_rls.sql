-- ============================================================================
-- 2026-04-22 — Paridad lunch_orders ↔ transactions, vista de deuda, Storage RLS
--
-- 1) view_student_debts: tramo "almuerzo_virtual" sin filtrar por payment_method
--    del pedido, y con NOT EXISTS que también excluya pagos "split" que solo
--    guardan original_lunch_ids (sin lunch_order_id por fila).
-- 2) fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval: asegura
--    UPDATE a pending/parcial y INSERT "espejo" pagada cuando el voucher trae
--    lunch_order_ids. Invocada por los RPCs de aprobación (mismo efecto que un
--    trigger differible, con orden de ejecución seguro en la transacción).
-- 3) process_traditional_voucher_approval: NO_DEBTS_FOUND no bloquea el caso
--    solo almuerzosvirtuales; v_updated_ids refleja comprobantes creado/curados.
-- 4) approve_split_payment_voucher: llama a la misma función de paridad
-- 5) storage.objects: operativos (incl. operador_caja) pueden r/w en vouchers
-- ============================================================================

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- A) Paridad 1:1 (SECURITY DEFINER) — usada SOLO por RPCs de aprobación
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
  p_request_id         uuid,
  p_student_id         uuid,
  p_school_id          uuid,
  p_lunch_ids          uuid[],
  p_payment_method     text,
  p_admin_id           uuid,
  p_voucher_url        text,
  p_reference_code     text,
  p_request_type       text,
  p_is_taxable         boolean,
  p_billing_status     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lo_rec        record;
  v_psrc        text;
  v_tkt         text;
  n_insert      int := 0;
  v_line_amount numeric(12,2);
  v_desc        text;
BEGIN
  IF p_lunch_ids IS NULL OR cardinality(p_lunch_ids) = 0 THEN
    RETURN;
  END IF;

  v_psrc := CASE p_request_type
    WHEN 'debt_payment'  THEN 'debt_voucher_payment'
    WHEN 'lunch_payment' THEN 'lunch_voucher_payment'
    ELSE 'voucher_payment'
  END;

  -- 1) Saldar transacciones de compra ya existentes (evita huérfanas fuera de paid_transaction_ids)
  UPDATE public.transactions t
  SET
    payment_status = 'paid',
    payment_method = COALESCE(NULLIF(TRIM(p_payment_method), ''), t.payment_method),
    is_taxable     = p_is_taxable,
    billing_status = p_billing_status,
    metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'payment_approved', true,
      'source_channel', 'parent_web',
      'payment_source', v_psrc,
      'recharge_request_id', p_request_id::text,
      'reference_code', p_reference_code,
      'approved_by', p_admin_id::text,
      'approved_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'voucher_url', p_voucher_url,
      'last_payment_rejected', false
    )
  WHERE t.is_deleted    = false
    AND t.type          = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND t.metadata->>'lunch_order_id' IS NOT NULL
    AND (t.metadata->>'lunch_order_id')::uuid = ANY(p_lunch_ids);

  -- 2) Insertar “espejo” solo si no queda NINGUNA transacción viva (no eliminada) con ese almuerzo
  FOR lo_rec IN
    SELECT
      lo.id,
      lo.student_id,
      lo.teacher_id,
      lo.manual_name,
      lo.order_date,
      lo.quantity,
      lo.final_price,
      lc.name AS menu_name,
      COALESCE(lo.school_id, st.school_id, tp.school_id_1) AS school_id,
      ABS(ROUND(
        CASE
          WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
            THEN lo.final_price
          WHEN lc.price IS NOT NULL AND lc.price > 0
            THEN lc.price * COALESCE(lo.quantity, 1)
          WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
            THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
          ELSE 7.50 * COALESCE(lo.quantity, 1)
        END, 2
      ))::numeric(10,2) AS line_amount
    FROM   public.lunch_orders       lo
    LEFT JOIN public.students            st   ON st.id  = lo.student_id
    LEFT JOIN public.teacher_profiles    tp   ON tp.id  = lo.teacher_id
    LEFT JOIN public.lunch_categories     lc   ON lc.id  = lo.category_id
    LEFT JOIN public.lunch_configuration  lcfg ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
    WHERE  lo.id = ANY(p_lunch_ids)
      AND  lo.is_cancelled = false
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.is_deleted = false
        AND t.metadata->>'lunch_order_id' = lo_rec.id::text
    ) THEN
      CONTINUE;
    END IF;

    v_line_amount := lo_rec.line_amount;
    n_insert := n_insert + 1;
    v_desc := 'Almuerzo - ' || COALESCE(lo_rec.menu_name, 'Menú') ||
      CASE WHEN COALESCE(lo_rec.quantity, 1) > 1
        THEN ' (' || lo_rec.quantity::text || 'x)' ELSE '' END ||
      ' - ' || to_char(lo_rec.order_date::date, 'DD/MM/YYYY');

    v_tkt := NULL;
    BEGIN
      SELECT get_next_ticket_number(p_admin_id) INTO v_tkt;
    EXCEPTION WHEN OTHERS THEN
      v_tkt := 'MRR-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || n_insert::text;
    END;

    INSERT INTO public.transactions (
      type,
      amount,
      payment_status,
      payment_method,
      description,
      student_id,
      teacher_id,
      manual_client_name,
      school_id,
      created_by,
      ticket_code,
      is_taxable,
      billing_status,
      metadata
    ) VALUES (
      'purchase',
      v_line_amount,
      'paid',
      COALESCE(NULLIF(TRIM(p_payment_method), ''), 'voucher'),
      v_desc,
      lo_rec.student_id,
      lo_rec.teacher_id,
      lo_rec.manual_name,
      COALESCE(lo_rec.school_id, p_school_id),
      p_admin_id,
      v_tkt,
      p_is_taxable,
      p_billing_status,
      jsonb_build_object(
        'lunch_order_id',        lo_rec.id::text,
        'source',                'lunch_approval_mirror',
        'recharge_request_id',  p_request_id::text,
        'lunch_approval_mirror', 'true',
        'payment_approved',      true,
        'source_channel',        'parent_web',
        'payment_source',        v_psrc,
        'reference_code',       p_reference_code,
        'approved_by',          p_admin_id::text,
        'approved_at',          to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'voucher_url',          p_voucher_url
      )
    );
  END LOOP;

END;
$$;

COMMENT ON FUNCTION public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
  uuid, uuid, uuid, uuid[], text, uuid, text, text, text, boolean, text
) IS
  '2026-04-22 — Cierre 1:1: marca paid las compras con lunch_order_id y crea el espejo si no existía. '
  'Llamar solo desde RPCs SECURITY DEFINER (process_traditional_voucher_approval, approve_split_payment_voucher).';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- B) Vista: deuda almuerzo = estado del pedido + transacción ausente/activa
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP VIEW IF EXISTS public.view_student_debts CASCADE;

CREATE VIEW public.view_student_debts AS
-- Tramo 1: compras con deuda
SELECT
  t.id::text                                              AS deuda_id,
  t.student_id                                            AS student_id,
  t.teacher_id                                            AS teacher_id,
  t.manual_client_name::text                              AS manual_client_name,
  t.school_id                                             AS school_id,
  ABS(t.amount)::numeric(10,2)                            AS monto,
  COALESCE(t.description, 'Deuda sin descripción')        AS descripcion,
  t.created_at                                            AS fecha,
  'transaccion'::text                                     AS fuente,
  ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS es_almuerzo,
  t.metadata                                              AS metadata,
  t.ticket_code                                           AS ticket_code
FROM public.transactions t
WHERE t.type           = 'purchase'
  AND t.is_deleted     = false
  AND t.payment_status IN ('pending', 'partial')
UNION ALL
-- Tramo 2: almuerzos sin registro de compra (o cuyo pago vive solo en split fiscal)
SELECT
  ('lunch_' || lo.id::text)::text                         AS deuda_id,
  lo.student_id                                           AS student_id,
  lo.teacher_id                                           AS teacher_id,
  lo.manual_name::text                                    AS manual_client_name,
  COALESCE(lo.school_id, st.school_id, tp.school_id_1)   AS school_id,
  ABS(ROUND(
    CASE
      WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
        THEN lo.final_price
      WHEN lc.price IS NOT NULL AND lc.price > 0
        THEN lc.price * COALESCE(lo.quantity, 1)
      WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
        THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
      ELSE 7.50 * COALESCE(lo.quantity, 1)
    END, 2
  ))::numeric(10,2)                                       AS monto,
  (
    'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
    CASE WHEN COALESCE(lo.quantity, 1) > 1
      THEN ' (' || lo.quantity::text || 'x)' ELSE '' END ||
    ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
  )::text                                                 AS descripcion,
  (lo.order_date::date + interval '12 hours')::timestamptz AS fecha,
  'almuerzo_virtual'::text                                AS fuente,
  true                                                    AS es_almuerzo,
  jsonb_build_object(
    'lunch_order_id', lo.id::text,
    'source',         'lunch_order',
    'order_date',     lo.order_date
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code
FROM public.lunch_orders lo
LEFT JOIN public.students         st   ON st.id  = lo.student_id
LEFT JOIN public.teacher_profiles tp   ON tp.id  = lo.teacher_id
LEFT JOIN public.lunch_categories lc   ON lc.id  = lo.category_id
LEFT JOIN public.lunch_configuration lcfg ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
WHERE lo.is_cancelled = false
  AND lo.status NOT IN ('cancelled')
  AND NOT EXISTS (
    SELECT 1
    FROM   public.transactions t2
    WHERE  t2.is_deleted     = false
      AND  t2.payment_status IN ('pending', 'partial', 'paid')
      AND  (
        (t2.metadata->>'lunch_order_id') = lo.id::text
        OR
        (t2.metadata ? 'original_lunch_ids' AND t2.metadata->'original_lunch_ids' @> to_jsonb(ARRAY[lo.id::text]))
      )
  )
UNION ALL
-- Tramo 3: saldo kiosco negativo sin deuda pendiente explícita
SELECT
  ('kiosk_balance_' || s.id::text)::text                  AS deuda_id,
  s.id                                                    AS student_id,
  NULL::uuid                                              AS teacher_id,
  NULL::text                                              AS manual_client_name,
  s.school_id                                             AS school_id,
  ABS(s.balance)::numeric(10,2)                           AS monto,
  'Deuda en kiosco (saldo negativo)'::text                 AS descripcion,
  NOW()                                                   AS fecha,
  'saldo_negativo'::text                                  AS fuente,
  false                                                   AS es_almuerzo,
  jsonb_build_object(
    'is_kiosk_balance_debt', true,
    'balance',               s.balance
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code
FROM public.students s
WHERE s.balance   < 0
  AND s.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM   public.transactions t3
    WHERE  t3.student_id     = s.id
      AND  t3.type           = 'purchase'
      AND  t3.is_deleted     = false
      AND  t3.payment_status IN ('pending', 'partial')
      AND  (t3.metadata->>'lunch_order_id') IS NULL
  );

GRANT SELECT ON public.view_student_debts TO authenticated, service_role;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- C) process_traditional_voucher_approval v7.2
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
BEGIN
  -- Bypass local para evitar que el trigger de POS (kiosco/topes)
  -- bloquee una aprobación administrativa de voucher.
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

  -- Guardia de estado: bloquear si ya fue rechazado, void u otro estado terminal.
  -- Si ya está 'approved' (aprobación huérfana: status actualizado pero transacciones
  -- no completadas), verificar si realmente hay transacciones pagadas.
  -- Si sí existen → ya fue procesado: retornar éxito idempotente.
  -- Si NO existen → aprobación huérfana: omitir el UPDATE (evita ANTIFRAUDE trigger)
  --                 y continuar completando el procesamiento.
  IF v_req.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION
      'ALREADY_PROCESSED: La solicitud ya tiene estado "%". '
      'Otro administrador la procesó primero.',
      v_req.status;
  END IF;

  IF v_req.status = 'approved' THEN
    -- Verificar si el procesamiento ya está completo (hay transacciones paid vinculadas)
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
      -- Pago ya procesado completamente: retornar éxito sin duplicar nada.
      RETURN jsonb_build_object(
        'success',         true,
        'request_id',      p_request_id,
        'already_complete', true,
        'message',         'Pago ya procesado correctamente en un paso anterior.'
      );
    END IF;
    -- Aprobación huérfana: el status es 'approved' pero no hay transacciones pagadas.
    -- Continuar sin ejecutar el UPDATE para no disparar el trigger antifraude.
  ELSE
    -- Estado 'pending' normal: marcar como aprobado ahora.
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

  -- Guard NO_DEBT: no bloquea “solo almuerzos” sin transacción todavía
  IF COALESCE(cardinality(v_tx_ids), 0) = 0
     AND COALESCE(cardinality(v_lunch_ids), 0) = 0
  THEN
    SELECT balance INTO v_student_balance
    FROM   students
    WHERE  id = v_req.student_id;

    -- Flujo simplificado: no abortar por diferencias de monto/deuda.
    -- Si no hay deuda aplicable, el monto completo se maneja como recarga.
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
      -- Flujo simplificado: no abortar; derivar a recarga.
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

    -- Vincular student_id en compras espejo huérfanas (caso órdenes de docente)
    -- para que la factura aparezca en el perfil correcto del padre.
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

    -- Anchor fiscal: una transacción pagada del alumno para enlazar la boleta/PDF.
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

    -- Persistir IDs aplicados al request para que facturación calcule el total real
    -- desde transacciones efectivamente pagadas.
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
      v_req.amount,
      v_req.invoice_type,
      v_req.invoice_client_data,
      'pending'
    )
    RETURNING id INTO v_billing_queue_id;
  END IF;

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
  'v7.4 2026-04-22 — Aprobación idempotente: detecta aprobaciones huérfanas (status=approved sin '
  'transacciones pagadas) y completa el procesamiento sin disparar trg_guard_voucher_approval. '
  'Bypass controlado de KIOSK_DISABLED/topes para flujos administrativos. '
  'Anchor fiscal transaction_id para boleta/PDF. Auditoría idempotente en audit_billing_logs.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- D) approve_split_payment_voucher: paridad almuerzos
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION public.approve_split_payment_voucher(
  p_request_id       uuid,
  p_operation_number text     DEFAULT NULL,
  p_admin_notes      text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_caller_role    text;
  req              record;
  v_wallet_amount  numeric;
  v_fiscal_amount  numeric;
  v_fiscal_tx_id   uuid;
  v_wallet_tx_id   uuid;
  v_ticket_base    text;
  v_student        record;
BEGIN
  -- Bypass local para evitar bloqueo de trigger POS durante aprobación administrativa.
  PERFORM set_config('app.bypass_spending_limit', 'on', true);

  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN (
    'admin_general', 'gestor_unidad', 'cajero', 'operador_caja',
    'supervisor_red', 'superadmin'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Solo administradores pueden aprobar pagos';
  END IF;

  SELECT *
  INTO   req
  FROM   recharge_requests
  WHERE  id     = p_request_id
    AND  status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ALREADY_PROCESSED: El comprobante ya fue aprobado o rechazado por otro administrador';
  END IF;

  v_wallet_amount := COALESCE(req.wallet_amount, 0);
  v_fiscal_amount := req.amount;

  IF req.paid_transaction_ids IS NOT NULL AND
     array_length(req.paid_transaction_ids, 1) > 0 THEN

    PERFORM id
    FROM    transactions
    WHERE   id = ANY(req.paid_transaction_ids::uuid[])
    FOR UPDATE;

    IF EXISTS (
      SELECT 1 FROM transactions
      WHERE  id = ANY(req.paid_transaction_ids::uuid[])
        AND  payment_status NOT IN ('pending', 'partial')
    ) THEN
      RAISE EXCEPTION
        'CONFLICT: Algunas deudas ya fueron cobradas por otro proceso. '
        'Recarga la lista e intenta de nuevo.';
    END IF;
  END IF;

  IF v_wallet_amount > 0 THEN
    SELECT *
    INTO   v_student
    FROM   students
    WHERE  id = req.student_id
    FOR UPDATE;

    IF v_student.wallet_balance < v_wallet_amount THEN
      RAISE EXCEPTION
        'INSUFFICIENT_WALLET: El saldo de la billetera bajó entre el envío y la aprobación. '
        'Saldo actual: S/ %, requerido: S/ %',
        v_student.wallet_balance, v_wallet_amount;
    END IF;
  END IF;

  UPDATE recharge_requests
  SET
    status      = 'approved',
    approved_by = v_caller_id,
    approved_at = now(),
    notes       = COALESCE(p_admin_notes, notes)
  WHERE id     = p_request_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'RACE_CONDITION: Otro administrador aprobó este voucher en el mismo instante';
  END IF;

  IF req.paid_transaction_ids IS NOT NULL AND
     array_length(req.paid_transaction_ids, 1) > 0 THEN

    UPDATE transactions
    SET
      payment_status   = 'paid',
      payment_method   = CASE WHEN v_wallet_amount > 0 THEN 'mixto' ELSE 'voucher' END,
      operation_number = p_operation_number,
      billing_status   = CASE WHEN v_wallet_amount > 0 THEN 'excluded' ELSE billing_status END,
      created_by       = v_caller_id
    WHERE id = ANY(req.paid_transaction_ids::uuid[])
      AND payment_status IN ('pending', 'partial');

  END IF;

  -- Paridad: almuerzos listados o solo cubiertos por transacción virtual
  IF req.lunch_order_ids IS NOT NULL AND
     array_length(req.lunch_order_ids, 1) > 0 THEN
    PERFORM public.fn_ensure_paid_purchase_mirrors_for_lunch_voucher_approval(
      p_request_id,
      req.student_id,
      req.school_id,
      req.lunch_order_ids,
      CASE WHEN v_wallet_amount > 0 THEN 'mixto' ELSE COALESCE(req.payment_method, 'voucher') END,
      v_caller_id,
      req.voucher_url,
      req.reference_code,
      req.request_type,
      (v_wallet_amount <= 0),
      CASE WHEN v_wallet_amount > 0 THEN 'excluded' ELSE 'pending' END
    );
  END IF;

  IF v_wallet_amount > 0 THEN

    INSERT INTO wallet_transactions (
      student_id,
      school_id,
      amount,
      type,
      applied_to_session_id,
      description,
      created_by
    ) VALUES (
      req.student_id,
      req.school_id,
      -v_wallet_amount,
      'payment_debit',
      NULL,
      'Pago de deuda — billetera usada en voucher #' ||
        COALESCE(p_operation_number, req.id::text),
      v_caller_id
    )
    RETURNING id INTO v_wallet_tx_id;

    PERFORM adjust_student_wallet_balance(req.student_id, -v_wallet_amount);

  END IF;

  IF v_fiscal_amount > 0 THEN

    BEGIN
      SELECT get_next_ticket_number(v_caller_id) INTO v_ticket_base;
    EXCEPTION WHEN OTHERS THEN
      v_ticket_base := 'COB-' || to_char(now(), 'YYYYMMDD-HH24MISS');
    END;

    INSERT INTO transactions (
      type,
      amount,
      payment_status,
      payment_method,
      operation_number,
      description,
      student_id,
      school_id,
      created_by,
      is_taxable,
      billing_status,
      ticket_code,
      metadata
    ) VALUES (
      'purchase',
      v_fiscal_amount,
      'paid',
      'voucher',
      p_operation_number,
      COALESCE(
        req.description,
        'Pago de deuda — voucher aprobado'
      ),
      req.student_id,
      req.school_id,
      v_caller_id,
      true,
      'pending',
      v_ticket_base,
      jsonb_build_object(
        'recharge_request_id',  p_request_id,
        'wallet_amount_used',   v_wallet_amount,
        'is_split_payment',     v_wallet_amount > 0,
        'wallet_tx_id',         v_wallet_tx_id,
        'original_debt_ids',    req.paid_transaction_ids,
        'original_lunch_ids',   req.lunch_order_ids,
        'source',               'split_voucher_approval'
      )
    )
    RETURNING id INTO v_fiscal_tx_id;

  END IF;

  IF req.lunch_order_ids IS NOT NULL AND
     array_length(req.lunch_order_ids, 1) > 0 THEN

    UPDATE lunch_orders
    SET
      status       = 'delivered',
      delivered_at = now()
    WHERE id     = ANY(req.lunch_order_ids)
      AND status NOT IN ('delivered', 'cancelled');

  END IF;

  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      v_caller_id,
      'APROBACION_PAGO_DIVIDIDO',
      'COBRANZAS',
      jsonb_build_object(
        'request_id',         p_request_id,
        'student_id',         req.student_id,
        'wallet_amount',      v_wallet_amount,
        'fiscal_amount',      v_fiscal_amount,
        'fiscal_tx_id',       v_fiscal_tx_id,
        'wallet_tx_id',       v_wallet_tx_id,
        'operation_number',   p_operation_number,
        'debt_tx_ids',        req.paid_transaction_ids,
        'lunch_order_ids',    req.lunch_order_ids,
        'admin_notes',        p_admin_notes
      ),
      req.school_id,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'AUDIT_LOG_FAILED en approve_split_payment_voucher: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success',              true,
    'fiscal_tx_id',         v_fiscal_tx_id,
    'wallet_tx_id',         v_wallet_tx_id,
    'wallet_amount_used',   v_wallet_amount,
    'fiscal_amount',        v_fiscal_amount,
    'should_invoice',       v_fiscal_amount > 0,
    'message',
      CASE
        WHEN v_wallet_amount > 0 AND v_fiscal_amount > 0
          THEN 'Pago aprobado. S/ ' || v_wallet_amount ||
               ' descontados de la billetera + S/ ' || v_fiscal_amount ||
               ' del voucher. Boleta por S/ ' || v_fiscal_amount || ' generada.'
        WHEN v_wallet_amount > 0 AND v_fiscal_amount = 0
          THEN 'Pago aprobado con saldo a favor completo. No se emite boleta.'
        ELSE
          'Pago aprobado con voucher. Boleta por S/ ' || v_fiscal_amount || ' generada.'
      END
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- E) Trigger límites POS: bypass local para flujos administrativos (voucher)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION public.tg_enforce_spending_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student    RECORD;
  v_now_lima   timestamptz;
  v_week_start timestamptz;
  v_spent_week numeric := 0;
  v_available  numeric := 0;
BEGIN
  IF current_setting('app.bypass_spending_limit', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Solo compras de kiosco: type='purchase' sin lunch_order_id
  IF NEW.type IS DISTINCT FROM 'purchase' THEN
    RETURN NEW;
  END IF;

  IF (NEW.metadata->>'lunch_order_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT kiosk_disabled, limit_type, weekly_limit
    INTO v_student
  FROM public.students
  WHERE id = NEW.student_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_student.kiosk_disabled IS TRUE THEN
    RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado. Solo puede pedir almuerzos desde el calendario.';
  END IF;

  IF v_student.limit_type IS DISTINCT FROM 'weekly' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_student.weekly_limit, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_now_lima   := timezone('America/Lima', now());
  v_week_start := date_trunc('week', v_now_lima) AT TIME ZONE 'America/Lima';

  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_week
  FROM public.transactions t
  WHERE t.student_id             = NEW.student_id
    AND t.type                   = 'purchase'
    AND t.is_deleted             = false
    AND t.payment_status        != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at            >= v_week_start;

  v_available := GREATEST(0, v_student.weekly_limit - v_spent_week);

  IF (v_spent_week + ABS(NEW.amount)) > v_student.weekly_limit THEN
    RAISE EXCEPTION 'SPENDING_LIMIT: ¡Límite alcanzado! Esta semana ya gastó S/ %, solo le quedan S/ % y esta compra es de S/ %.',
      round(v_spent_week, 2),
      round(v_available, 2),
      round(ABS(NEW.amount), 2);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_enforce_spending_limit()
IS 'v2: mantiene bloqueo POS (kiosk_disabled + weekly_limit) y permite bypass local controlado para aprobaciones administrativas de voucher.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- F) Storage: bucket vouchers — staff (incl. operador_caja) sin restricción de carpeta
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vouchers',
  'vouchers',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "admin_borrar_vouchers" ON storage.objects;
DROP POLICY IF EXISTS "staff_vouchers_maintain" ON storage.objects;
DROP POLICY IF EXISTS "staff_vouchers_maintain_select" ON storage.objects;
DROP POLICY IF EXISTS "staff_vouchers_maintain_insert" ON storage.objects;
DROP POLICY IF EXISTS "staff_vouchers_maintain_update" ON storage.objects;
DROP POLICY IF EXISTS "staff_vouchers_maintain_delete" ON storage.objects;

CREATE POLICY "staff_vouchers_maintain_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'vouchers'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN (
        'admin_general', 'gestor_unidad', 'superadmin', 'operador_caja', 'cajero', 'supervisor_red'
      )
  )
);

CREATE POLICY "staff_vouchers_maintain_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vouchers'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN (
        'admin_general', 'gestor_unidad', 'superadmin', 'operador_caja', 'cajero', 'supervisor_red'
      )
  )
);

CREATE POLICY "staff_vouchers_maintain_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'vouchers'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN (
        'admin_general', 'gestor_unidad', 'superadmin', 'operador_caja', 'cajero', 'supervisor_red'
      )
  )
)
WITH CHECK (
  bucket_id = 'vouchers'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN (
        'admin_general', 'gestor_unidad', 'superadmin', 'operador_caja', 'cajero', 'supervisor_red'
      )
  )
);

CREATE POLICY "staff_vouchers_maintain_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'vouchers'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN (
        'admin_general', 'gestor_unidad', 'superadmin', 'operador_caja', 'cajero', 'supervisor_red'
      )
  )
);

-- PostgREST
NOTIFY pgrst, 'reload schema';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- F) Validación manual (ej. Thiago Alarcón) — ejecutar en SQL editor tras el deploy
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1) Resolver alumno: SELECT id, full_name, parent_id FROM public.students
--    WHERE is_active = true AND full_name ILIKE '%Thiago%Alarcón%';
-- 2) Suma de deuda (debe alinearse con get_parent_debts_v2 del padre):
--    SELECT fuente, COUNT(*), ROUND(SUM(monto),2) FROM public.view_student_debts
--    WHERE student_id = 'UUID' GROUP BY fuente;
-- 3) Integridad de perfiles: SELECT id, role, school_id FROM public.profiles WHERE id = auth.uid();
--    (la migración no modifica perfiles; solo añade políticas storage dependientes de profiles.role)
-- :fin
