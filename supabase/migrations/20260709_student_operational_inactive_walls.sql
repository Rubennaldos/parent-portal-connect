-- ============================================================================
-- 2026-07-09 — Alumno inactivo operativo (is_active = false)
--
-- CONTRATO DE NEGOCIO:
--   is_active = true  → operativo (POS, almuerzos, ventas nuevas, recargas)
--   is_active = false → inactivo / "en gris"
--     · NO opera: POS, almuerzos, ventas nuevas, recargas nuevas
--     · SÍ cobra: deudas pendientes visibles en Cobranzas y portal padre
--     · SÍ conserva historial, saldo y auditoría
--
-- AUTORIDAD: PostgreSQL (triggers + RPC). El frontend solo presenta.
-- NO TOCA: IziPay, webhooks, apply_gateway_credit, payment HMAC.
--
-- Prefijo de error: STUDENT_INACTIVE
-- ============================================================================

BEGIN;

-- ── 0. Columna canónica (idempotente) ───────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.students.is_active IS
  'Operativo=true. false=inactivo: bloquea POS/almuerzos/recargas; deudas siguen visibles.';

CREATE INDEX IF NOT EXISTS idx_students_is_active
  ON public.students (is_active)
  WHERE is_active = false;

-- ============================================================================
-- 1. Helper: assert_student_operational
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assert_student_operational(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_active boolean;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(s.is_active, true)
    INTO v_active
  FROM public.students s
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND: Alumno no encontrado (id: %)', p_student_id;
  END IF;

  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION
      'STUDENT_INACTIVE: Este alumno está inactivo. No puede operar en POS, almuerzos ni recibir recargas. Sus deudas siguen en Cobranzas.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_student_operational(uuid) IS
  'Muralla: lanza STUDENT_INACTIVE si el alumno no está operativo (is_active=false).';

REVOKE ALL ON FUNCTION public.assert_student_operational(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_student_operational(uuid) TO authenticated, service_role;

-- ============================================================================
-- 2. RPC única: set_student_operational_status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_student_operational_status(
  p_student_id uuid,
  p_is_active  boolean,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_caller_school uuid;
  v_student     RECORD;
  v_now         timestamptz := clock_timestamp();
  v_prev        boolean;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Debe iniciar sesión.';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'STUDENT_REQUIRED: Falta el alumno.';
  END IF;

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'STATUS_REQUIRED: Falta el estado operativo.';
  END IF;

  SELECT role, school_id
    INTO v_caller_role, v_caller_school
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS NULL
     OR v_caller_role NOT IN (
       'superadmin', 'admin_general', 'gestor_unidad', 'admin_sede', 'admin'
     )
  THEN
    RAISE EXCEPTION 'FORBIDDEN: Solo administradores pueden activar/desactivar alumnos.';
  END IF;

  SELECT id, full_name, school_id, parent_id, is_active, balance
    INTO v_student
  FROM public.students
  WHERE id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND: Alumno no encontrado (id: %)', p_student_id;
  END IF;

  -- Admin de sede / gestor: solo su sede
  IF v_caller_role IN ('gestor_unidad', 'admin_sede', 'admin')
     AND v_caller_school IS NOT NULL
     AND v_student.school_id IS DISTINCT FROM v_caller_school
  THEN
    RAISE EXCEPTION 'FORBIDDEN: No puede cambiar alumnos de otra sede.';
  END IF;

  v_prev := COALESCE(v_student.is_active, true);

  -- Idempotente: mismo estado → OK sin reescribir
  IF v_prev IS NOT DISTINCT FROM p_is_active THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'student_id', p_student_id,
      'is_active', p_is_active,
      'full_name', v_student.full_name
    );
  END IF;

  UPDATE public.students
  SET is_active = p_is_active
  WHERE id = p_student_id;

  INSERT INTO public.audit_logs (
    action,
    admin_user_id,
    target_user_id,
    details,
    "timestamp",
    created_at
  ) VALUES (
    CASE WHEN p_is_active THEN 'student_reactivate' ELSE 'student_deactivate' END,
    v_caller_id,
    COALESCE(v_student.parent_id, p_student_id),
    format(
      'Alumno %s (%s) → is_active=%s. Motivo: %s. Saldo al momento: S/ %s. Admin role: %s.',
      v_student.full_name,
      p_student_id,
      p_is_active::text,
      COALESCE(NULLIF(trim(p_reason), ''), 'sin motivo'),
      COALESCE(v_student.balance, 0),
      v_caller_role
    ),
    v_now,
    v_now
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'student_id', p_student_id,
    'full_name', v_student.full_name,
    'previous_is_active', v_prev,
    'is_active', p_is_active
  );
END;
$$;

COMMENT ON FUNCTION public.set_student_operational_status(uuid, boolean, text) IS
  'Única vía autorizada para activar/desactivar alumno operativo. Audita en audit_logs. Idempotente.';

REVOKE ALL ON FUNCTION public.set_student_operational_status(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_student_operational_status(uuid, boolean, text) TO authenticated;

-- ============================================================================
-- 3. Muralla lunch_orders (BEFORE INSERT)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_block_inactive_student_lunch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.student_id IS NOT NULL THEN
    PERFORM public.assert_student_operational(NEW.student_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_inactive_student_lunch ON public.lunch_orders;
CREATE TRIGGER trg_block_inactive_student_lunch
  BEFORE INSERT ON public.lunch_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_inactive_student_lunch();

COMMENT ON FUNCTION public.tg_block_inactive_student_lunch() IS
  'BEFORE INSERT lunch_orders: bloquea pedidos de alumnos inactivos (STUDENT_INACTIVE).';

-- ============================================================================
-- 4. Muralla transactions kiosco — extender tg_enforce_spending_limit
--    (misma función; se añade is_active SIN quitar kiosk_disabled / topes)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_enforce_spending_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student       RECORD;
  v_now_lima      timestamptz;
  v_period_start  timestamptz;
  v_limit_amount  numeric := 0;
  v_spent_period  numeric := 0;
  v_available     numeric := 0;
BEGIN
  IF current_setting('app.bypass_spending_limit', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.type IS DISTINCT FROM 'purchase' THEN
    RETURN NEW;
  END IF;

  -- Almuerzo: no aplica tope de kiosco (regla de oro).
  -- El bloqueo de alumno inactivo vive en trg_block_inactive_student_lunch.
  IF (NEW.metadata->>'lunch_order_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.payment_status, 'pending') NOT IN ('pending', 'paid') THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(is_active, true)      AS is_active,
    kiosk_disabled,
    COALESCE(limit_type, 'none')   AS limit_type,
    COALESCE(daily_limit, 0)       AS daily_limit,
    COALESCE(weekly_limit, 0)      AS weekly_limit,
    COALESCE(monthly_limit, 0)     AS monthly_limit
  INTO v_student
  FROM public.students
  WHERE id = NEW.student_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- ── Guard 0: alumno inactivo (muralla operativa) ─────────────────────────
  IF v_student.is_active IS NOT TRUE THEN
    RAISE EXCEPTION
      'STUDENT_INACTIVE: Este alumno está inactivo. No puede comprar en POS. Sus deudas siguen en Cobranzas.';
  END IF;

  IF COALESCE(v_student.kiosk_disabled, false) THEN
    RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado. Solo puede pedir almuerzos.';
  END IF;

  IF v_student.limit_type = 'none' THEN
    RETURN NEW;
  END IF;

  v_now_lima := timezone('America/Lima', now());

  IF v_student.limit_type = 'daily' THEN
    v_limit_amount := v_student.daily_limit;
    v_period_start := date_trunc('day', v_now_lima) AT TIME ZONE 'America/Lima';
  ELSIF v_student.limit_type = 'weekly' THEN
    v_limit_amount := v_student.weekly_limit;
    v_period_start := date_trunc('week', v_now_lima) AT TIME ZONE 'America/Lima';
  ELSIF v_student.limit_type = 'monthly' THEN
    v_limit_amount := v_student.monthly_limit;
    v_period_start := date_trunc('month', v_now_lima) AT TIME ZONE 'America/Lima';
  ELSE
    RETURN NEW;
  END IF;

  IF v_limit_amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_period
  FROM public.transactions t
  WHERE t.student_id = NEW.student_id
    AND t.type = 'purchase'
    AND t.is_deleted = false
    AND t.payment_status != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at >= v_period_start;

  v_available := GREATEST(0, v_limit_amount - v_spent_period);

  IF (v_spent_period + ABS(NEW.amount)) > v_limit_amount THEN
    RAISE EXCEPTION 'SPENDING_LIMIT: Tope % superado. Gastado: S/ %, disponible: S/ %, compra intentada: S/ %.',
      v_student.limit_type,
      round(v_spent_period, 2),
      round(v_available, 2),
      round(ABS(NEW.amount), 2);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_enforce_spending_limit() IS
  'Muralla kiosco: STUDENT_INACTIVE + KIOSK_DISABLED + topes. Almuerzos excluidos (lunch_order_id).';

-- ============================================================================
-- 5. Muralla recargas NUEVAS (recharge_requests) — NO bloquea debt_payment
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_block_inactive_student_recharge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Solo recargas de saldo nuevas. Pagar deuda / almuerzo SÍ se permite.
  IF COALESCE(lower(trim(NEW.request_type)), 'recharge') = 'recharge'
     AND NEW.student_id IS NOT NULL
  THEN
    PERFORM public.assert_student_operational(NEW.student_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_inactive_student_recharge ON public.recharge_requests;
CREATE TRIGGER trg_block_inactive_student_recharge
  BEFORE INSERT ON public.recharge_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_inactive_student_recharge();

COMMENT ON FUNCTION public.tg_block_inactive_student_recharge() IS
  'BEFORE INSERT recharge_requests: bloquea request_type=recharge si alumno inactivo. Permite debt_payment/lunch_payment.';

-- ============================================================================
-- 6. Muralla payment_sessions de recarga (sin tocar IziPay webhook)
--    Bloquea crear sesión de RECARGAR saldo a inactivo.
--    Permite debt_payment / lunch_payment.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_block_inactive_student_payment_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(lower(trim(NEW.request_type)), 'recharge') = 'recharge'
     AND NEW.student_id IS NOT NULL
  THEN
    PERFORM public.assert_student_operational(NEW.student_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_inactive_student_payment_session ON public.payment_sessions;
CREATE TRIGGER trg_block_inactive_student_payment_session
  BEFORE INSERT ON public.payment_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_inactive_student_payment_session();

COMMENT ON FUNCTION public.tg_block_inactive_student_payment_session() IS
  'BEFORE INSERT payment_sessions: bloquea recarga nueva a inactivo. No toca webhooks ni apply_gateway_credit.';

-- ============================================================================
-- 7. NFC: exponer student_is_active (POS decide UI; DB ya bloquea venta)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_nfc_holder(text);

CREATE OR REPLACE FUNCTION public.get_nfc_holder(p_card_uid text)
RETURNS TABLE (
  holder_type            text,
  student_id             uuid,
  student_name           text,
  student_grade          text,
  student_section        text,
  student_balance        float8,
  student_free_account   boolean,
  student_kiosk_disabled boolean,
  student_is_active      boolean,
  student_limit_type     text,
  student_daily_limit    float8,
  student_weekly_limit   float8,
  student_monthly_limit  float8,
  student_school_id      uuid,
  teacher_id             uuid,
  teacher_name           text,
  card_number            text,
  is_active              boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.holder_type::text,
    nc.student_id,
    s.full_name::text           AS student_name,
    s.grade::text               AS student_grade,
    s.section::text             AS student_section,
    s.balance::float8           AS student_balance,
    s.free_account::boolean     AS student_free_account,
    s.kiosk_disabled::boolean   AS student_kiosk_disabled,
    COALESCE(s.is_active, true)::boolean AS student_is_active,
    s.limit_type::text          AS student_limit_type,
    s.daily_limit::float8       AS student_daily_limit,
    s.weekly_limit::float8      AS student_weekly_limit,
    s.monthly_limit::float8     AS student_monthly_limit,
    s.school_id                 AS student_school_id,
    nc.teacher_id,
    p.full_name::text           AS teacher_name,
    nc.card_number::text,
    nc.is_active
  FROM public.nfc_cards nc
  LEFT JOIN public.students s ON s.id = nc.student_id
  LEFT JOIN public.profiles p ON p.id = nc.teacher_id
  WHERE nc.card_uid = p_card_uid
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_nfc_holder(text) IS
  'Lookup NFC. Incluye student_is_active. Venta sigue bloqueada en DB si inactivo.';

REVOKE ALL ON FUNCTION public.get_nfc_holder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nfc_holder(text) TO authenticated, service_role;

-- ============================================================================
-- 8. Deudas del padre: INACTIVOS SÍ aparecen (quitar filtro is_active)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_parent_debts_v2(uuid);

CREATE OR REPLACE FUNCTION public.get_parent_debts_v2(p_parent_id uuid)
RETURNS TABLE(
  deuda_id                 text,
  student_id               uuid,
  school_id                uuid,
  monto                    numeric,
  descripcion              text,
  fecha                    timestamptz,
  fuente                   text,
  es_almuerzo              boolean,
  metadata                 jsonb,
  ticket_code              text,
  voucher_status           text,
  voucher_request_id       uuid,
  voucher_rejection_reason text,
  summary_total_bruto      numeric,
  summary_in_review        numeric,
  summary_neto_payable     numeric,
  summary_student_total     numeric,
  summary_student_payable   numeric,
  summary_student_in_review numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN RETURN; END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red')
    AND v_caller_id <> p_parent_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  -- 2026-07-09: incluir hijos inactivos — la deuda no se esconde al desactivar
  student_ids AS (
    SELECT s.id AS sid, s.school_id AS s_school_id, s.balance AS s_balance
    FROM   public.students s
    WHERE  s.parent_id = p_parent_id
  ),

  debts_raw AS (

    SELECT
      t.id::text                                              AS deuda_id,
      t.student_id                                            AS student_id,
      t.school_id                                             AS school_id,
      ABS(t.amount)::numeric(10,2)                            AS monto,
      COALESCE(t.description, 'Deuda sin descripción')        AS descripcion,
      t.created_at                                            AS fecha,
      'transaccion'::text                                     AS fuente,
      ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS es_almuerzo,
      t.metadata                                              AS metadata,
      t.ticket_code                                           AS ticket_code
    FROM public.transactions t
    WHERE t.student_id IN (SELECT sid FROM student_ids)
      AND t.type           = 'purchase'
      AND t.is_deleted     = false
      AND t.payment_status IN ('pending', 'partial')

    UNION ALL

    SELECT
      ('lunch_' || lo.id::text)::text                         AS deuda_id,
      lo.student_id                                           AS student_id,
      COALESCE(lo.school_id, si.s_school_id)                  AS school_id,
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
    JOIN student_ids si ON si.sid = lo.student_id
    LEFT JOIN public.lunch_categories lc
           ON lc.id = lo.category_id
    LEFT JOIN public.lunch_configuration lcfg
           ON lcfg.school_id = COALESCE(lo.school_id, si.s_school_id)
    WHERE lo.is_cancelled = false
      AND lo.status NOT IN ('cancelled')
      AND NOT EXISTS (
        SELECT 1
        FROM   public.transactions t2
        WHERE  t2.is_deleted     = false
          AND  t2.student_id     = lo.student_id
          AND  t2.payment_status IN ('pending', 'partial', 'paid', 'cancelled')
          AND  (
            (t2.metadata->>'lunch_order_id') = lo.id::text
            OR
            (t2.metadata ? 'original_lunch_ids'
             AND t2.metadata->'original_lunch_ids' @> to_jsonb(ARRAY[lo.id::text]))
            OR
            (
              t2.type = 'purchase'
              AND t2.payment_status = 'paid'
              AND NULLIF(t2.metadata->>'lunch_metadata_repair_prior_lunch_order_id', '')
                = lo.id::text
            )
          )
      )

    UNION ALL

    SELECT
      ('kiosk_balance_' || si.sid::text)::text                AS deuda_id,
      si.sid                                                  AS student_id,
      si.s_school_id                                          AS school_id,
      ABS(si.s_balance)::numeric(10,2)                        AS monto,
      'Deuda en kiosco (saldo negativo)'::text                 AS descripcion,
      NOW()                                                   AS fecha,
      'saldo_negativo'::text                                  AS fuente,
      false                                                   AS es_almuerzo,
      jsonb_build_object(
        'is_kiosk_balance_debt', true,
        'balance', si.s_balance
      )                                                       AS metadata,
      NULL::text                                              AS ticket_code
    FROM student_ids si
    WHERE si.s_balance < 0
      AND NOT EXISTS (
        SELECT 1
        FROM   public.transactions t3
        WHERE  t3.student_id     = si.sid
          AND  t3.type           = 'purchase'
          AND  t3.is_deleted     = false
          AND  t3.payment_status IN ('pending', 'partial')
          AND  (t3.metadata->>'lunch_order_id') IS NULL
      )
  ),

  debts_base AS (
    SELECT
      dr.*,
      CASE WHEN dr.fuente = 'transaccion'
        THEN dr.deuda_id::uuid ELSE NULL::uuid
      END AS deuda_tx_uuid,
      CASE WHEN dr.fuente = 'almuerzo_virtual'
        THEN (dr.metadata->>'lunch_order_id')::uuid ELSE NULL::uuid
      END AS lunch_uuid
    FROM debts_raw dr
  ),

  debts_with_voucher AS (
    SELECT
      db.deuda_id,
      db.student_id,
      db.school_id,
      db.monto,
      db.descripcion,
      db.fecha,
      db.fuente,
      db.es_almuerzo,
      db.metadata,
      db.ticket_code,
      rr_match.status           AS voucher_status,
      rr_match.id               AS voucher_request_id,
      rr_match.rejection_reason AS voucher_rejection_reason
    FROM debts_base db
    LEFT JOIN LATERAL (
      SELECT rr.id, rr.status, rr.rejection_reason
      FROM   public.recharge_requests rr
      WHERE  rr.parent_id = p_parent_id
        AND  rr.status    IN ('pending', 'rejected')
        AND  (
          (db.deuda_tx_uuid IS NOT NULL
           AND rr.paid_transaction_ids IS NOT NULL
           AND db.deuda_tx_uuid = ANY(rr.paid_transaction_ids))
          OR
          (db.lunch_uuid IS NOT NULL
           AND rr.lunch_order_ids IS NOT NULL
           AND db.lunch_uuid = ANY(rr.lunch_order_ids))
          OR
          (db.fuente = 'saldo_negativo'
           AND rr.student_id = db.student_id
           AND rr.request_type IN ('debt_payment', 'recharge'))
        )
      ORDER BY rr.created_at DESC
      LIMIT 1
    ) rr_match ON true
  )

  SELECT
    dv.deuda_id,
    dv.student_id,
    dv.school_id,
    dv.monto,
    dv.descripcion,
    dv.fecha,
    dv.fuente,
    dv.es_almuerzo,
    dv.metadata,
    dv.ticket_code,
    dv.voucher_status,
    dv.voucher_request_id,
    dv.voucher_rejection_reason,
    SUM(dv.monto) OVER ()
      AS summary_total_bruto,
    SUM(CASE WHEN dv.voucher_status = 'pending' THEN dv.monto ELSE 0 END) OVER ()
      AS summary_in_review,
    SUM(CASE WHEN (dv.voucher_status IS DISTINCT FROM 'pending') THEN dv.monto ELSE 0 END) OVER ()
      AS summary_neto_payable,
    SUM(dv.monto) OVER (PARTITION BY dv.student_id)
      AS summary_student_total,
    SUM(CASE WHEN (dv.voucher_status IS DISTINCT FROM 'pending') THEN dv.monto ELSE 0 END) OVER (PARTITION BY dv.student_id)
      AS summary_student_payable,
    SUM(CASE WHEN dv.voucher_status = 'pending' THEN dv.monto ELSE 0 END) OVER (PARTITION BY dv.student_id)
      AS summary_student_in_review
  FROM debts_with_voucher dv
  ORDER BY dv.fecha DESC;

END;
$$;

COMMENT ON FUNCTION public.get_parent_debts_v2(uuid) IS
  'v3.2 2026-07-09 — Incluye hijos inactivos (is_active=false). Deuda no se esconde al desactivar. '
  'Preserva tramo almuerzo_virtual + lunch_metadata_repair_prior.';

GRANT EXECUTE ON FUNCTION public.get_parent_debts_v2(uuid) TO authenticated, service_role;

-- ============================================================================
-- 9. view_student_debts Tramo 3: saldo negativo también de inactivos
-- ============================================================================
DROP VIEW IF EXISTS public.view_student_debts CASCADE;

CREATE VIEW public.view_student_debts AS
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
      AND  t2.payment_status IN ('pending', 'partial', 'paid', 'cancelled')
      AND  (
        (t2.metadata->>'lunch_order_id') = lo.id::text
        OR
        (t2.metadata ? 'original_lunch_ids' AND t2.metadata->'original_lunch_ids' @> to_jsonb(ARRAY[lo.id::text]))
      )
  )
UNION ALL
-- Tramo 3: 2026-07-09 — SIN filtro is_active (deuda de inactivo sigue visible)
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

COMMIT;

SELECT '20260709_student_operational_inactive_walls OK — murallas DB + deudas visibles + RPC status' AS resultado;
