-- ============================================================================
-- FIX SSOT: Deuda virtual de almuerzo → ticket real en transactions
-- Fecha: 2026-07-10
-- Caso forense: Betsy Díaz Zevallos
--
-- PROBLEMA:
--   get_parent_debts_v2 muestra lunch_orders sin fila en transactions (ID lunch_<uuid>).
--   IziPay y void_pending_debt_from_billing exigen UUID real → padre atrapado /
--   admin con error de tipado aunque la UI muestre deuda.
--
-- SOLUCIÓN (autoridad en PostgreSQL, no en React):
--   1) Índice único parcial: un solo ticket pending/partial por lunch_order_id
--   2) ensure_lunch_debt_transactions_for_payment — materializa idempotente
--   3) Trigger AFTER INSERT: pedidos frozen nacen con ticket pending
--   4) void_virtual_lunch_debt_from_billing — anula virtual o delega a void real
--   5) Guard payment_sessions: lunch_order_ids también vinculan deuda
--
-- NO TOCA: izipay-create-order, izipay-webhook, apply_gateway_credit, HMAC.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Prerrequisitos
-- ============================================================================
DO $guard$
BEGIN
  IF to_regclass('public.transactions') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE_MISSING: public.transactions';
  END IF;
  IF to_regclass('public.lunch_orders') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE_MISSING: public.lunch_orders';
  END IF;
END;
$guard$;

-- ============================================================================
-- 1. Índice único parcial — anti-duplicidad de tickets por almuerzo
--    Si hay duplicados históricos pending, falla con mensaje accionable.
-- ============================================================================
DO $dup$
DECLARE
  v_dup_count integer;
  v_sample    text;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT t.metadata->>'lunch_order_id' AS lid
    FROM   public.transactions t
    WHERE  t.type = 'purchase'
      AND  t.is_deleted = false
      AND  t.payment_status IN ('pending', 'partial')
      AND  NULLIF(t.metadata->>'lunch_order_id', '') IS NOT NULL
    GROUP BY t.metadata->>'lunch_order_id'
    HAVING COUNT(*) > 1
  ) d;

  IF v_dup_count > 0 THEN
    SELECT string_agg(lid, ', ')
      INTO v_sample
    FROM (
      SELECT t.metadata->>'lunch_order_id' AS lid
      FROM   public.transactions t
      WHERE  t.type = 'purchase'
        AND  t.is_deleted = false
        AND  t.payment_status IN ('pending', 'partial')
        AND  NULLIF(t.metadata->>'lunch_order_id', '') IS NOT NULL
      GROUP BY t.metadata->>'lunch_order_id'
      HAVING COUNT(*) > 1
      LIMIT 5
    ) s;

    RAISE EXCEPTION
      'DUPLICATE_LUNCH_PENDING: % lunch_order_id(s) con más de un ticket pending/partial. '
      'Ejemplos: %. Resolver antes de crear el índice único.',
      v_dup_count, COALESCE(v_sample, '(sin muestra)');
  END IF;
END;
$dup$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_one_open_per_lunch_order
  ON public.transactions ((metadata->>'lunch_order_id'))
  WHERE type = 'purchase'
    AND is_deleted = false
    AND payment_status IN ('pending', 'partial')
    AND NULLIF(metadata->>'lunch_order_id', '') IS NOT NULL;

COMMENT ON INDEX public.uq_tx_one_open_per_lunch_order IS
  'Idempotencia: un solo ticket purchase pending/partial por lunch_order_id.';

-- ============================================================================
-- 2. ensure_lunch_debt_transactions_for_payment
--    Materializa lunch_orders → transactions.pending. Idempotente.
-- ============================================================================
DROP FUNCTION IF EXISTS public.ensure_lunch_debt_transactions_for_payment(uuid, uuid[], uuid);

CREATE OR REPLACE FUNCTION public.ensure_lunch_debt_transactions_for_payment(
  p_student_id       uuid,
  p_lunch_order_ids  uuid[],
  p_parent_id        uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller_id      uuid;
  v_caller_role    text;
  v_parent_id      uuid;
  v_lo_id          uuid;
  v_rec            record;
  v_new_tx_id      uuid;
  v_tx_ids         uuid[] := '{}';
  v_materialized   integer := 0;
  v_existing       integer := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado.' USING ERRCODE = 'P0001';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'STUDENT_REQUIRED: student_id es obligatorio.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(cardinality(p_lunch_order_ids), 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'transaction_ids', '[]'::jsonb,
      'materialized_count', 0,
      'existing_count', 0
    );
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  SELECT s.parent_id INTO v_parent_id
  FROM   public.students s
  WHERE  s.id = p_student_id;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Alumno % no existe.', p_student_id USING ERRCODE = 'P0001';
  END IF;

  IF v_caller_role NOT IN (
       'admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red', 'admin_sede'
     )
     AND v_caller_id <> COALESCE(p_parent_id, v_parent_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: No tiene permiso para materializar deudas de este alumno.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_parent_id IS NOT NULL AND p_parent_id IS DISTINCT FROM v_parent_id THEN
    RAISE EXCEPTION 'FORBIDDEN: El alumno no pertenece al padre indicado.'
      USING ERRCODE = 'P0001';
  END IF;

  FOREACH v_lo_id IN ARRAY p_lunch_order_ids
  LOOP
    -- Ticket abierto ya existente (idempotencia)
    SELECT t.id
      INTO v_new_tx_id
    FROM   public.transactions t
    WHERE  t.student_id = p_student_id
      AND  t.type = 'purchase'
      AND  t.is_deleted = false
      AND  t.payment_status IN ('pending', 'partial')
      AND  (t.metadata->>'lunch_order_id') = v_lo_id::text
    ORDER BY t.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_tx_ids := array_append(v_tx_ids, v_new_tx_id);
      v_existing := v_existing + 1;
      CONTINUE;
    END IF;

    -- ¿Ya pagado? No re-materializar; devolver el paid más reciente
    SELECT t.id
      INTO v_new_tx_id
    FROM   public.transactions t
    WHERE  t.student_id = p_student_id
      AND  t.type = 'purchase'
      AND  t.is_deleted = false
      AND  t.payment_status = 'paid'
      AND  (t.metadata->>'lunch_order_id') = v_lo_id::text
    ORDER BY t.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'LUNCH_ALREADY_PAID: El pedido % ya tiene ticket pagado (%). Actualiza la pantalla.',
        v_lo_id, v_new_tx_id
        USING ERRCODE = 'P0001';
    END IF;

    SELECT
      lo.id,
      lo.order_date,
      lo.student_id,
      lo.teacher_id,
      COALESCE(lo.school_id, st.school_id, tp.school_id_1) AS school_id,
      lo.manual_name,
      lo.is_cancelled,
      lo.status,
      lo.payment_flow_state::text AS payment_flow_state,
      ABS(ROUND(
        CASE
          WHEN lo.final_price IS NOT NULL AND lo.final_price > 0 THEN lo.final_price
          WHEN lc.price IS NOT NULL AND lc.price > 0 THEN lc.price * COALESCE(lo.quantity, 1)
          WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
            THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
          ELSE 7.50 * COALESCE(lo.quantity, 1)
        END, 2
      )) AS amount,
      (
        'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
        CASE WHEN COALESCE(lo.quantity, 1) > 1
          THEN ' (' || lo.quantity::text || 'x)' ELSE '' END ||
        ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
      ) AS description
    INTO v_rec
    FROM   public.lunch_orders lo
    LEFT JOIN public.students st ON st.id = lo.student_id
    LEFT JOIN public.teacher_profiles tp ON tp.id = lo.teacher_id
    LEFT JOIN public.lunch_categories lc ON lc.id = lo.category_id
    LEFT JOIN public.lunch_configuration lcfg
           ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
    WHERE  lo.id = v_lo_id
      AND  lo.student_id = p_student_id
    FOR UPDATE OF lo;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LUNCH_NOT_FOUND: Pedido % no existe o no pertenece al alumno.', v_lo_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_rec.is_cancelled
       OR v_rec.status = 'cancelled'
       OR COALESCE(v_rec.payment_flow_state, '') = 'cancelled_expired' THEN
      RAISE EXCEPTION 'LUNCH_NOT_PAYABLE: El pedido % está cancelado o vencido.', v_lo_id
        USING ERRCODE = 'P0001';
    END IF;

    BEGIN
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
        metadata,
        is_deleted,
        created_at
      ) VALUES (
        'purchase',
        -ABS(v_rec.amount),
        'pending',
        CASE
          WHEN v_rec.payment_flow_state = 'frozen_pending_payment' THEN 'prepago_congelado'
          ELSE 'pagar_luego'
        END,
        v_rec.description,
        v_rec.student_id,
        v_rec.teacher_id,
        v_rec.manual_name,
        v_rec.school_id,
        jsonb_build_object(
          'lunch_order_id', v_lo_id::text,
          'source',         'ensure_lunch_debt_for_payment',
          'order_date',     v_rec.order_date,
          'payment_flow_state', COALESCE(v_rec.payment_flow_state, 'legacy')
        ),
        false,
        (v_rec.order_date::date + interval '12 hours') AT TIME ZONE 'America/Lima'
      )
      RETURNING id INTO v_new_tx_id;
    EXCEPTION
      WHEN unique_violation THEN
        -- Carrera: otro proceso materializó primero
        SELECT t.id INTO v_new_tx_id
        FROM   public.transactions t
        WHERE  t.is_deleted = false
          AND  t.payment_status IN ('pending', 'partial')
          AND  (t.metadata->>'lunch_order_id') = v_lo_id::text
        ORDER BY t.created_at DESC
        LIMIT 1;

        IF v_new_tx_id IS NULL THEN
          RAISE;
        END IF;
        v_tx_ids := array_append(v_tx_ids, v_new_tx_id);
        v_existing := v_existing + 1;
        CONTINUE;
    END;

    v_tx_ids := array_append(v_tx_ids, v_new_tx_id);
    v_materialized := v_materialized + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_ids', to_jsonb(v_tx_ids),
    'materialized_count', v_materialized,
    'existing_count', v_existing
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.ensure_lunch_debt_transactions_for_payment(uuid, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_lunch_debt_transactions_for_payment(uuid, uuid[], uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ensure_lunch_debt_transactions_for_payment(uuid, uuid[], uuid) IS
  'SSOT pre-checkout: materializa lunch_orders virtuales en transactions.pending. '
  'Idempotente (índice único + SELECT previo). Devuelve UUID reales para paid_tx_ids. '
  'No toca pasarela IziPay.';

-- ============================================================================
-- 3. Trigger: pedidos frozen nacen con ticket pending (cierra el hueco a futuro)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_fn_materialize_frozen_lunch_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_amount numeric;
  v_desc   text;
  v_school uuid;
  v_cat    text;
BEGIN
  IF NEW.is_cancelled THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.payment_flow_state::text, '') <> 'frozen_pending_payment' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.is_deleted = false
      AND t.payment_status IN ('pending', 'partial', 'paid')
      AND (t.metadata->>'lunch_order_id') = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT lc.name INTO v_cat
  FROM   public.lunch_categories lc
  WHERE  lc.id = NEW.category_id;

  SELECT COALESCE(NEW.school_id, st.school_id, tp.school_id_1)
    INTO v_school
  FROM   (SELECT 1) _
  LEFT JOIN public.students st ON st.id = NEW.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = NEW.teacher_id;

  v_amount := ABS(ROUND(
    CASE
      WHEN NEW.final_price IS NOT NULL AND NEW.final_price > 0 THEN NEW.final_price
      WHEN NEW.base_price IS NOT NULL AND NEW.base_price > 0
        THEN NEW.base_price * COALESCE(NEW.quantity, 1)
      ELSE 7.50 * COALESCE(NEW.quantity, 1)
    END, 2
  ));

  v_desc := 'Almuerzo - ' || COALESCE(v_cat, 'Menú')
    || CASE WHEN COALESCE(NEW.quantity, 1) > 1
         THEN ' (' || NEW.quantity::text || 'x)' ELSE '' END
    || ' - ' || to_char(NEW.order_date::date, 'DD/MM/YYYY');

  BEGIN
    INSERT INTO public.transactions (
      type, amount, payment_status, payment_method, description,
      student_id, teacher_id, manual_client_name, school_id,
      metadata, is_deleted, created_at, created_by
    ) VALUES (
      'purchase',
      -v_amount,
      'pending',
      'prepago_congelado',
      v_desc,
      NEW.student_id,
      NEW.teacher_id,
      NEW.manual_name,
      v_school,
      jsonb_build_object(
        'lunch_order_id', NEW.id::text,
        'source', 'trg_materialize_frozen_lunch',
        'order_date', NEW.order_date,
        'payment_flow_state', 'frozen_pending_payment'
      ),
      false,
      (NEW.order_date::date + interval '12 hours') AT TIME ZONE 'America/Lima',
      NEW.created_by
    );
  EXCEPTION
    WHEN unique_violation THEN
      NULL; -- ya materializado por carrera
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_materialize_frozen_lunch_on_insert ON public.lunch_orders;
CREATE TRIGGER trg_materialize_frozen_lunch_on_insert
  AFTER INSERT ON public.lunch_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_materialize_frozen_lunch_on_insert();

COMMENT ON TRIGGER trg_materialize_frozen_lunch_on_insert ON public.lunch_orders IS
  'SSOT: frozen_pending_payment crea ticket pending en transactions al nacer. '
  'Evita deudas virtuales lunch_* en get_parent_debts_v2 para pedidos nuevos.';

-- ============================================================================
-- 4. void_virtual_lunch_debt_from_billing
-- ============================================================================
DROP FUNCTION IF EXISTS public.void_virtual_lunch_debt_from_billing(uuid, text);

CREATE OR REPLACE FUNCTION public.void_virtual_lunch_debt_from_billing(
  p_lunch_order_id  uuid,
  p_reason          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor_id        uuid;
  v_actor_role      text;
  v_actor_school_id uuid;
  v_lo              public.lunch_orders%ROWTYPE;
  v_pending_tx_id   uuid;
  v_now_lima        timestamptz;
BEGIN
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 15 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: El motivo es obligatorio y debe tener al menos 15 caracteres.'
      USING ERRCODE = 'P0001';
  END IF;

  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.role, p.school_id
    INTO v_actor_role, v_actor_school_id
  FROM   public.profiles p
  WHERE  p.id = v_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN (
    'superadmin', 'admin_general', 'admin_sede', 'gestor_unidad'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: El rol % no está autorizado.', COALESCE(v_actor_role, 'sin_rol')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_lo
  FROM   public.lunch_orders
  WHERE  id = p_lunch_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Pedido de almuerzo % no existe.', p_lunch_order_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_lo.is_cancelled OR v_lo.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'lunch_order_id', p_lunch_order_id,
      'debt_type', 'virtual_lunch',
      'already_cancelled', true,
      'transaction_voided', false
    );
  END IF;

  IF v_actor_role IN ('admin_sede', 'gestor_unidad') THEN
    IF v_lo.school_id IS DISTINCT FROM v_actor_school_id THEN
      RAISE EXCEPTION 'FORBIDDEN_SCHOOL: No tiene permiso para anular pedidos de otra sede.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_now_lima := timezone('America/Lima', now());

  -- Si ya hay ticket pending → misma autoridad que void_pending_debt_from_billing
  SELECT t.id INTO v_pending_tx_id
  FROM   public.transactions t
  WHERE  (t.metadata->>'lunch_order_id') = p_lunch_order_id::text
    AND  t.type = 'purchase'
    AND  t.is_deleted = false
    AND  t.payment_status IN ('pending', 'partial')
  ORDER BY t.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN public.void_pending_debt_from_billing(v_pending_tx_id, p_reason);
  END IF;

  UPDATE public.lunch_orders
  SET
    is_cancelled        = true,
    status              = 'cancelled',
    cancelled_by        = v_actor_id,
    cancelled_at        = v_now_lima,
    cancellation_reason = TRIM(p_reason)
      || ' [anulado deuda virtual desde Cobranzas por ' || v_actor_role || ']',
    payment_flow_state  = CASE
      WHEN payment_flow_state IS NOT NULL
        THEN 'cancelled_expired'::public.lunch_order_payment_state
      ELSE payment_flow_state
    END
  WHERE id = p_lunch_order_id;

  INSERT INTO public.audit_billing_logs (
    action_type, table_name, record_id, old_data, new_data,
    changed_by_user_id, school_id, created_at
  ) VALUES (
    'VOID_VIRTUAL_LUNCH_DEBT_FROM_BILLING',
    'lunch_orders',
    p_lunch_order_id,
    jsonb_build_object(
      'is_cancelled', v_lo.is_cancelled,
      'status', v_lo.status,
      'student_id', v_lo.student_id,
      'payment_flow_state', v_lo.payment_flow_state
    ),
    jsonb_build_object(
      'is_cancelled', true,
      'status', 'cancelled',
      'cancellation_reason', TRIM(p_reason),
      'void_source', 'void_virtual_lunch_debt_from_billing'
    ),
    v_actor_id,
    v_lo.school_id,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'lunch_order_id', p_lunch_order_id,
    'debt_type', 'virtual_lunch',
    'already_cancelled', false,
    'transaction_voided', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.void_virtual_lunch_debt_from_billing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_virtual_lunch_debt_from_billing(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.void_virtual_lunch_debt_from_billing(uuid, text) IS
  'Anula deuda virtual de almuerzo desde Cobranzas. Si ya hay ticket pending, '
  'delega a void_pending_debt_from_billing. Auditoría en audit_billing_logs.';

-- ============================================================================
-- 5. Guard payment_sessions: lunch_order_ids también vinculan deuda IziPay
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_guard_payment_sessions_debt_ids()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.gateway_name, '') = 'izipay'
     AND COALESCE(NEW.request_type, 'recharge') IN ('debt_payment', 'lunch_payment')
     AND COALESCE(cardinality(NEW.debt_tx_ids), 0) = 0
     AND COALESCE(cardinality(NEW.lunch_order_ids), 0) = 0
  THEN
    RAISE EXCEPTION
      'VALIDATION_ERROR: debt_tx_ids o lunch_order_ids requerido para request_type=% en IziPay',
      NEW.request_type;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

SELECT '20260710_fix_virtual_lunch_debt_payment_bridge OK' AS resultado;
