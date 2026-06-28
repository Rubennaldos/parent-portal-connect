-- ============================================================================
-- BITÁCORA DE PAGOS — Fuente C: pagos online IziPay (debt_payment / lunch_payment)
-- Fecha: 2026-06-29
--
-- Solo lectura. No toca webhooks, apply_gateway_credit ni saldos.
--
-- Problema resuelto:
--   Deudas cerradas por IziPay (CARD, sin operation_number en cada TX) caían
--   en admin_single como "cobros de Fernanda" o no aparecían agrupadas.
--   Ahora cada payment_session completada = 1 evento con padre + ref IziPay.
-- ============================================================================

-- Helper inline: transacción ya cubierta por sesión IziPay completada
-- (usado para excluir duplicados en fuentes admin)

DROP FUNCTION IF EXISTS public.list_debt_payment_bitacora(uuid, timestamptz, timestamptz, text, uuid, int, int);

CREATE OR REPLACE FUNCTION public.list_debt_payment_bitacora(
  p_school_id    uuid        DEFAULT NULL,
  p_date_from    timestamptz DEFAULT NULL,
  p_date_to      timestamptz DEFAULT NULL,
  p_search_term  text        DEFAULT NULL,
  p_collector_id uuid        DEFAULT NULL,
  p_limit        int         DEFAULT 50,
  p_offset       int         DEFAULT 0
)
RETURNS TABLE (
  event_id         text,
  event_type       text,
  event_ts         timestamptz,
  amount           numeric,
  student_name     text,
  student_count    int,
  school_name      text,
  school_id        uuid,
  payment_method   text,
  operation_number text,
  ticket_count     int,
  parent_name      text,
  parent_email     text,
  collector_name   text,
  collector_email  text,
  voucher_url      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_school_id   uuid := p_school_id;
  v_search      text;
  v_limit       int  := GREATEST(LEAST(COALESCE(p_limit,  50), 200), 1);
  v_offset      int  := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Acceso restringido a administradores';
  END IF;

  IF v_caller_role = 'gestor_unidad' THEN
    SELECT school_id INTO v_school_id FROM public.profiles WHERE id = auth.uid();
  END IF;

  IF p_search_term IS NOT NULL AND TRIM(p_search_term) <> '' THEN
    v_search := '%' || TRIM(p_search_term) || '%';
  END IF;

  RETURN QUERY
  WITH
  src_voucher AS (
    SELECT
      rr.id::text                                                          AS event_id,
      'voucher'::text                                                      AS event_type,
      rr.approved_at                                                       AS event_ts,
      rr.amount                                                            AS amount,
      st.full_name::text                                                   AS student_name,
      1::int                                                               AS student_count,
      sc.name::text                                                        AS school_name,
      rr.school_id                                                         AS school_id,
      rr.payment_method::text                                              AS payment_method,
      rr.reference_code::text                                              AS operation_number,
      (
        COALESCE(array_length(rr.paid_transaction_ids, 1), 0) +
        COALESCE(array_length(rr.lunch_order_ids,      1), 0)
      )::int                                                               AS ticket_count,
      COALESCE(NULLIF(TRIM(pp.full_name), ''), pr.full_name)::text        AS parent_name,
      COALESCE(NULLIF(TRIM(pp.email),     ''), pr.email)::text            AS parent_email,
      ap.full_name::text                                                   AS collector_name,
      ap.email::text                                                       AS collector_email,
      rr.voucher_url::text                                                 AS voucher_url
    FROM public.recharge_requests   rr
    JOIN public.students            st  ON st.id      = rr.student_id
    JOIN public.schools             sc  ON sc.id      = rr.school_id
    LEFT JOIN public.parent_profiles pp  ON pp.user_id = rr.parent_id
    LEFT JOIN public.profiles        pr  ON pr.id      = rr.parent_id
    LEFT JOIN public.profiles        ap  ON ap.id      = rr.approved_by
    WHERE rr.status       = 'approved'
      AND rr.request_type IN ('debt_payment', 'lunch_payment')
      AND (v_school_id    IS NULL OR rr.school_id   = v_school_id)
      AND (p_date_from    IS NULL OR rr.approved_at >= p_date_from)
      AND (p_date_to      IS NULL OR rr.approved_at <= p_date_to)
      AND (p_collector_id IS NULL OR rr.approved_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name      ILIKE v_search
        OR pp.full_name      ILIKE v_search
        OR pr.full_name      ILIKE v_search
        OR pp.email          ILIKE v_search
        OR pr.email          ILIKE v_search
        OR rr.reference_code ILIKE v_search
      )
  ),

  -- Fuente C: Pago online IziPay del padre (payment_sessions completadas)
  src_izipay AS (
    SELECT
      ps.id::text                                                          AS event_id,
      'izipay'::text                                                       AS event_type,
      COALESCE(ps.completed_at, ps.reviewed_at, ps.created_at)             AS event_ts,
      ps.gateway_amount                                                    AS amount,
      st.full_name::text                                                   AS student_name,
      1::int                                                               AS student_count,
      sc.name::text                                                        AS school_name,
      ps.school_id                                                         AS school_id,
      CASE
        WHEN lower(COALESCE(gw_pm.payment_method, '')) IN ('card', 'visa', 'mastercard')
          THEN 'tarjeta'
        ELSE COALESCE(gw_pm.payment_method, 'tarjeta')
      END::text                                                            AS payment_method,
      ps.gateway_reference::text                                           AS operation_number,
      COALESCE(array_length(ps.debt_tx_ids, 1), 0)::int                    AS ticket_count,
      COALESCE(NULLIF(TRIM(pp.full_name), ''), pr.full_name)::text        AS parent_name,
      COALESCE(NULLIF(TRIM(pp.email),     ''), pr.email)::text            AS parent_email,
      NULL::text                                                           AS collector_name,
      NULL::text                                                           AS collector_email,
      NULL::text                                                           AS voucher_url
    FROM public.payment_sessions ps
    JOIN public.students           st ON st.id = ps.student_id
    JOIN public.schools            sc ON sc.id = ps.school_id
    LEFT JOIN public.parent_profiles pp ON pp.user_id = ps.parent_id
    LEFT JOIN public.profiles         pr ON pr.id      = ps.parent_id
    LEFT JOIN LATERAL (
      SELECT t.payment_method
      FROM public.transactions t
      WHERE t.gateway_reference_id = ps.gateway_reference
        AND t.student_id = ps.student_id
        AND t.is_deleted IS DISTINCT FROM TRUE
      ORDER BY t.created_at DESC
      LIMIT 1
    ) gw_pm ON TRUE
    WHERE ps.gateway_name = 'izipay'
      AND ps.gateway_status::text = 'success'
      AND ps.status::text = 'completed'
      AND ps.request_type IN ('debt_payment', 'lunch_payment')
      AND COALESCE(cardinality(ps.debt_tx_ids), 0) > 0
      AND ps.gateway_reference IS NOT NULL
      AND (v_school_id    IS NULL OR ps.school_id = v_school_id)
      AND (p_date_from    IS NULL OR COALESCE(ps.completed_at, ps.created_at) >= p_date_from)
      AND (p_date_to      IS NULL OR COALESCE(ps.completed_at, ps.created_at) <= p_date_to)
      AND p_collector_id IS NULL
      AND (
        v_search IS NULL
        OR st.full_name        ILIKE v_search
        OR pp.full_name        ILIKE v_search
        OR pr.full_name        ILIKE v_search
        OR pp.email            ILIKE v_search
        OR pr.email            ILIKE v_search
        OR ps.gateway_reference ILIKE v_search
        OR EXISTS (
          SELECT 1
          FROM public.transactions dt
          WHERE dt.id = ANY(ps.debt_tx_ids)
            AND (
              dt.ticket_code  ILIKE v_search
              OR dt.description ILIKE v_search
            )
        )
      )
  ),

  src_admin_group AS (
    SELECT
      (t.operation_number || '|||' || t.created_by::text || '|||' ||
        to_char(timezone('America/Lima', t.created_at), 'YYYY-MM-DD'))::text AS event_id,
      'admin_group'::text                                                    AS event_type,
      MIN(t.created_at)                                                      AS event_ts,
      SUM(ABS(t.amount))                                                     AS amount,
      CASE WHEN COUNT(DISTINCT t.student_id) = 1
           THEN MIN(st.full_name)::text
           ELSE NULL
      END                                                                    AS student_name,
      COUNT(DISTINCT t.student_id)::int                                      AS student_count,
      MIN(sc.name)::text                                                     AS school_name,
      t.school_id                                                            AS school_id,
      t.payment_method::text                                                 AS payment_method,
      t.operation_number::text                                               AS operation_number,
      COUNT(*)::int                                                          AS ticket_count,
      NULL::text                                                             AS parent_name,
      NULL::text                                                             AS parent_email,
      MIN(cr.full_name)::text                                                AS collector_name,
      MIN(cr.email)::text                                                    AS collector_email,
      NULL::text                                                             AS voucher_url
    FROM public.transactions  t
    JOIN public.students      st ON st.id = t.student_id
    JOIN public.schools       sc ON sc.id = t.school_id
    LEFT JOIN public.profiles cr ON cr.id = t.created_by
    WHERE t.type             = 'purchase'
      AND t.is_deleted       = false
      AND t.payment_status   = 'paid'
      AND t.operation_number IS NOT NULL
      AND (t.metadata->>'recharge_request_id') IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.payment_sessions psx
        WHERE psx.gateway_name = 'izipay'
          AND psx.gateway_status::text = 'success'
          AND psx.status::text = 'completed'
          AND COALESCE(cardinality(psx.debt_tx_ids), 0) > 0
          AND t.id = ANY(psx.debt_tx_ids)
      )
      AND (v_school_id    IS NULL OR t.school_id  = v_school_id)
      AND (p_date_from    IS NULL OR t.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR t.created_at <= p_date_to)
      AND (p_collector_id IS NULL OR t.created_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name       ILIKE v_search
        OR cr.full_name       ILIKE v_search
        OR t.operation_number ILIKE v_search
        OR t.ticket_code      ILIKE v_search
      )
    GROUP BY
      t.operation_number, t.created_by, t.school_id, t.payment_method,
      to_char(timezone('America/Lima', t.created_at), 'YYYY-MM-DD')
  ),

  src_admin_single AS (
    SELECT
      t.id::text                                                           AS event_id,
      'admin_single'::text                                                 AS event_type,
      t.created_at                                                         AS event_ts,
      ABS(t.amount)                                                        AS amount,
      st.full_name::text                                                   AS student_name,
      1::int                                                               AS student_count,
      sc.name::text                                                        AS school_name,
      t.school_id                                                          AS school_id,
      t.payment_method::text                                               AS payment_method,
      NULL::text                                                           AS operation_number,
      1::int                                                               AS ticket_count,
      NULL::text                                                           AS parent_name,
      NULL::text                                                           AS parent_email,
      cr.full_name::text                                                   AS collector_name,
      cr.email::text                                                       AS collector_email,
      NULL::text                                                           AS voucher_url
    FROM public.transactions  t
    JOIN public.students      st ON st.id = t.student_id
    JOIN public.schools       sc ON sc.id = t.school_id
    LEFT JOIN public.profiles cr ON cr.id = t.created_by
    WHERE t.type             = 'purchase'
      AND t.is_deleted       = false
      AND t.payment_status   = 'paid'
      AND t.operation_number IS NULL
      AND (t.metadata->>'recharge_request_id') IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.payment_sessions psx
        WHERE psx.gateway_name = 'izipay'
          AND psx.gateway_status::text = 'success'
          AND psx.status::text = 'completed'
          AND COALESCE(cardinality(psx.debt_tx_ids), 0) > 0
          AND t.id = ANY(psx.debt_tx_ids)
      )
      AND (v_school_id    IS NULL OR t.school_id  = v_school_id)
      AND (p_date_from    IS NULL OR t.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR t.created_at <= p_date_to)
      AND (p_collector_id IS NULL OR t.created_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name  ILIKE v_search
        OR cr.full_name  ILIKE v_search
        OR t.ticket_code ILIKE v_search
        OR t.description ILIKE v_search
      )
  )

  SELECT * FROM (
    SELECT * FROM src_voucher
    UNION ALL
    SELECT * FROM src_izipay
    UNION ALL
    SELECT * FROM src_admin_group
    UNION ALL
    SELECT * FROM src_admin_single
  ) combined
  ORDER BY event_ts DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_debt_payment_bitacora(uuid, timestamptz, timestamptz, text, uuid, int, int)
  TO authenticated;

COMMENT ON FUNCTION public.list_debt_payment_bitacora IS
  'Bitácora de pagos: voucher padre + IziPay online + cobro admin. Gestor solo ve su sede.';


-- ── count ────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.count_debt_payment_bitacora(uuid, timestamptz, timestamptz, text, uuid);

CREATE OR REPLACE FUNCTION public.count_debt_payment_bitacora(
  p_school_id    uuid        DEFAULT NULL,
  p_date_from    timestamptz DEFAULT NULL,
  p_date_to      timestamptz DEFAULT NULL,
  p_search_term  text        DEFAULT NULL,
  p_collector_id uuid        DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_school_id   uuid := p_school_id;
  v_search      text;
  v_total       bigint;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Acceso restringido a administradores';
  END IF;

  IF v_caller_role = 'gestor_unidad' THEN
    SELECT school_id INTO v_school_id FROM public.profiles WHERE id = auth.uid();
  END IF;

  IF p_search_term IS NOT NULL AND TRIM(p_search_term) <> '' THEN
    v_search := '%' || TRIM(p_search_term) || '%';
  END IF;

  WITH
  cnt_voucher AS (
    SELECT COUNT(*) AS n
    FROM public.recharge_requests   rr
    JOIN public.students            st  ON st.id      = rr.student_id
    LEFT JOIN public.parent_profiles pp  ON pp.user_id = rr.parent_id
    LEFT JOIN public.profiles        pr  ON pr.id      = rr.parent_id
    WHERE rr.status       = 'approved'
      AND rr.request_type IN ('debt_payment', 'lunch_payment')
      AND (v_school_id    IS NULL OR rr.school_id   = v_school_id)
      AND (p_date_from    IS NULL OR rr.approved_at >= p_date_from)
      AND (p_date_to      IS NULL OR rr.approved_at <= p_date_to)
      AND (p_collector_id IS NULL OR rr.approved_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name      ILIKE v_search
        OR pp.full_name      ILIKE v_search
        OR pr.full_name      ILIKE v_search
        OR pp.email          ILIKE v_search
        OR pr.email          ILIKE v_search
        OR rr.reference_code ILIKE v_search
      )
  ),
  cnt_izipay AS (
    SELECT COUNT(*) AS n
    FROM public.payment_sessions ps
    JOIN public.students           st ON st.id = ps.student_id
    LEFT JOIN public.parent_profiles pp ON pp.user_id = ps.parent_id
    LEFT JOIN public.profiles         pr ON pr.id      = ps.parent_id
    WHERE ps.gateway_name = 'izipay'
      AND ps.gateway_status::text = 'success'
      AND ps.status::text = 'completed'
      AND ps.request_type IN ('debt_payment', 'lunch_payment')
      AND COALESCE(cardinality(ps.debt_tx_ids), 0) > 0
      AND ps.gateway_reference IS NOT NULL
      AND (v_school_id    IS NULL OR ps.school_id = v_school_id)
      AND (p_date_from    IS NULL OR COALESCE(ps.completed_at, ps.created_at) >= p_date_from)
      AND (p_date_to      IS NULL OR COALESCE(ps.completed_at, ps.created_at) <= p_date_to)
      AND p_collector_id IS NULL
      AND (
        v_search IS NULL
        OR st.full_name         ILIKE v_search
        OR pp.full_name         ILIKE v_search
        OR pr.full_name         ILIKE v_search
        OR pp.email             ILIKE v_search
        OR pr.email             ILIKE v_search
        OR ps.gateway_reference ILIKE v_search
        OR EXISTS (
          SELECT 1 FROM public.transactions dt
          WHERE dt.id = ANY(ps.debt_tx_ids)
            AND (dt.ticket_code ILIKE v_search OR dt.description ILIKE v_search)
        )
      )
  ),
  cnt_admin_group AS (
    SELECT COUNT(DISTINCT
      (t.operation_number || '|||' || t.created_by::text || '|||' ||
       to_char(timezone('America/Lima', t.created_at), 'YYYY-MM-DD'))
    ) AS n
    FROM public.transactions  t
    JOIN public.students      st ON st.id = t.student_id
    LEFT JOIN public.profiles cr ON cr.id = t.created_by
    WHERE t.type             = 'purchase'
      AND t.is_deleted       = false
      AND t.payment_status   = 'paid'
      AND t.operation_number IS NOT NULL
      AND (t.metadata->>'recharge_request_id') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_sessions psx
        WHERE psx.gateway_name = 'izipay'
          AND psx.gateway_status::text = 'success'
          AND psx.status::text = 'completed'
          AND COALESCE(cardinality(psx.debt_tx_ids), 0) > 0
          AND t.id = ANY(psx.debt_tx_ids)
      )
      AND (v_school_id    IS NULL OR t.school_id  = v_school_id)
      AND (p_date_from    IS NULL OR t.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR t.created_at <= p_date_to)
      AND (p_collector_id IS NULL OR t.created_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name       ILIKE v_search
        OR cr.full_name       ILIKE v_search
        OR t.operation_number ILIKE v_search
        OR t.ticket_code      ILIKE v_search
      )
  ),
  cnt_admin_single AS (
    SELECT COUNT(*) AS n
    FROM public.transactions  t
    JOIN public.students      st ON st.id = t.student_id
    LEFT JOIN public.profiles cr ON cr.id = t.created_by
    WHERE t.type             = 'purchase'
      AND t.is_deleted       = false
      AND t.payment_status   = 'paid'
      AND t.operation_number IS NULL
      AND (t.metadata->>'recharge_request_id') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_sessions psx
        WHERE psx.gateway_name = 'izipay'
          AND psx.gateway_status::text = 'success'
          AND psx.status::text = 'completed'
          AND COALESCE(cardinality(psx.debt_tx_ids), 0) > 0
          AND t.id = ANY(psx.debt_tx_ids)
      )
      AND (v_school_id    IS NULL OR t.school_id  = v_school_id)
      AND (p_date_from    IS NULL OR t.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR t.created_at <= p_date_to)
      AND (p_collector_id IS NULL OR t.created_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name  ILIKE v_search
        OR cr.full_name  ILIKE v_search
        OR t.ticket_code ILIKE v_search
        OR t.description ILIKE v_search
      )
  )
  SELECT
    (SELECT n FROM cnt_voucher)
    + (SELECT n FROM cnt_izipay)
    + (SELECT n FROM cnt_admin_group)
    + (SELECT n FROM cnt_admin_single)
  INTO v_total;

  RETURN COALESCE(v_total, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_debt_payment_bitacora(uuid, timestamptz, timestamptz, text, uuid)
  TO authenticated;


-- ── tickets (lazy) ───────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_debt_payment_bitacora_tickets(text, text);

CREATE OR REPLACE FUNCTION public.get_debt_payment_bitacora_tickets(
  p_event_id   text,
  p_event_type text
)
RETURNS TABLE (
  transaction_id uuid,
  ticket_code    text,
  amount         numeric,
  description    text,
  is_lunch       boolean,
  payment_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_my_school   uuid;
  v_paid_tx_ids uuid[];
  v_lunch_ids   uuid[];
  v_rr_school   uuid;
  v_op_number   text;
  v_creator_id  uuid;
  v_date_lima   text;
  v_ps_school   uuid;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Acceso restringido a administradores';
  END IF;

  IF v_caller_role = 'gestor_unidad' THEN
    SELECT school_id INTO v_my_school FROM public.profiles WHERE id = auth.uid();
  END IF;

  IF p_event_type = 'voucher' THEN

    SELECT paid_transaction_ids, lunch_order_ids, school_id
    INTO   v_paid_tx_ids, v_lunch_ids, v_rr_school
    FROM   public.recharge_requests
    WHERE  id = p_event_id::uuid;

    IF NOT FOUND THEN RETURN; END IF;

    IF v_my_school IS NOT NULL AND v_rr_school <> v_my_school THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Esta solicitud pertenece a otra sede';
    END IF;

    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id,
      t.ticket_code::text,
      ABS(t.amount),
      COALESCE(t.description, '')::text,
      (t.metadata->>'lunch_order_id' IS NOT NULL OR t.description ILIKE '%Almuerzo%'),
      t.payment_status::text
    FROM public.transactions t
    WHERE t.is_deleted = false
      AND (
        (v_paid_tx_ids IS NOT NULL AND t.id = ANY(v_paid_tx_ids))
        OR
        (v_lunch_ids IS NOT NULL AND
         (t.metadata->>'lunch_order_id')::uuid = ANY(v_lunch_ids))
      )
    ORDER BY t.id, t.created_at;

  ELSIF p_event_type = 'izipay' THEN

    SELECT ps.debt_tx_ids, ps.school_id
    INTO   v_paid_tx_ids, v_ps_school
    FROM   public.payment_sessions ps
    WHERE  ps.id = p_event_id::uuid
      AND  ps.gateway_name = 'izipay'
      AND  ps.gateway_status::text = 'success'
      AND  ps.status::text = 'completed';

    IF NOT FOUND THEN RETURN; END IF;

    IF v_my_school IS NOT NULL AND v_ps_school <> v_my_school THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Esta sesión pertenece a otra sede';
    END IF;

    RETURN QUERY
    SELECT
      t.id,
      t.ticket_code::text,
      ABS(t.amount),
      COALESCE(t.description, '')::text,
      (t.metadata->>'lunch_order_id' IS NOT NULL OR t.description ILIKE '%Almuerzo%'),
      t.payment_status::text
    FROM public.transactions t
    WHERE t.is_deleted = false
      AND t.id = ANY(v_paid_tx_ids)
    ORDER BY t.created_at;

  ELSIF p_event_type = 'admin_group' THEN

    v_op_number  := split_part(p_event_id, '|||', 1);
    v_creator_id := split_part(p_event_id, '|||', 2)::uuid;
    v_date_lima  := split_part(p_event_id, '|||', 3);

    RETURN QUERY
    SELECT
      t.id,
      t.ticket_code::text,
      ABS(t.amount),
      COALESCE(t.description, '')::text,
      (t.metadata->>'lunch_order_id' IS NOT NULL OR t.description ILIKE '%Almuerzo%'),
      t.payment_status::text
    FROM public.transactions t
    WHERE t.is_deleted       = false
      AND t.type             = 'purchase'
      AND t.payment_status   = 'paid'
      AND t.operation_number = v_op_number
      AND t.created_by       = v_creator_id
      AND to_char(timezone('America/Lima', t.created_at), 'YYYY-MM-DD') = v_date_lima
      AND (t.metadata->>'recharge_request_id') IS NULL
      AND (v_my_school IS NULL OR t.school_id = v_my_school)
    ORDER BY t.created_at;

  ELSIF p_event_type = 'admin_single' THEN

    RETURN QUERY
    SELECT
      t.id,
      t.ticket_code::text,
      ABS(t.amount),
      COALESCE(t.description, '')::text,
      (t.metadata->>'lunch_order_id' IS NOT NULL OR t.description ILIKE '%Almuerzo%'),
      t.payment_status::text
    FROM public.transactions t
    WHERE t.id         = p_event_id::uuid
      AND t.is_deleted = false
      AND (v_my_school IS NULL OR t.school_id = v_my_school);

  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_debt_payment_bitacora_tickets(text, text)
  TO authenticated;


-- ── ticket detail: ref IziPay en N° operación cuando la TX no lo trae ────────

DROP FUNCTION IF EXISTS public.get_debt_payment_bitacora_ticket_detail(uuid);

CREATE OR REPLACE FUNCTION public.get_debt_payment_bitacora_ticket_detail(
  p_transaction_id uuid
)
RETURNS TABLE (
  transaction_id   uuid,
  ticket_code      text,
  amount           numeric,
  description      text,
  payment_status   text,
  payment_method   text,
  operation_number text,
  created_at       timestamptz,
  is_lunch         boolean,
  student_name     text,
  parent_name      text,
  parent_email     text,
  school_name      text,
  collector_name   text,
  collector_email  text,
  voucher_url      text,
  invoice_id       uuid,
  invoice_pdf_url  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_my_school   uuid;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Acceso restringido a administradores';
  END IF;

  IF v_caller_role = 'gestor_unidad' THEN
    SELECT school_id INTO v_my_school FROM public.profiles WHERE id = auth.uid();
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.ticket_code::text,
    ABS(t.amount),
    COALESCE(t.description, '')::text,
    t.payment_status::text,
    CASE
      WHEN lower(COALESCE(t.payment_method, '')) IN ('card', 'visa', 'mastercard')
        THEN 'tarjeta'
      ELSE t.payment_method
    END::text,
    COALESCE(
      NULLIF(TRIM(t.operation_number), ''),
      ps_hit.gateway_reference
    )::text,
    t.created_at,
    (t.metadata->>'lunch_order_id' IS NOT NULL OR t.description ILIKE '%Almuerzo%'),
    st.full_name::text,
    COALESCE(
      NULLIF(TRIM(pp_ps.full_name), ''),
      NULLIF(TRIM(pp.full_name), ''),
      pr.full_name
    )::text,
    COALESCE(
      NULLIF(TRIM(pp_ps.email), ''),
      NULLIF(TRIM(pp.email), ''),
      pr.email
    )::text,
    sc.name::text,
    CASE WHEN ps_hit.id IS NOT NULL THEN NULL ELSE cr.full_name END::text,
    CASE WHEN ps_hit.id IS NOT NULL THEN NULL ELSE cr.email END::text,
    COALESCE(t.metadata->>'voucher_url', rr.voucher_url)::text,
    t.invoice_id,
    inv.pdf_url::text
  FROM public.transactions t
  LEFT JOIN public.students          st   ON st.id      = t.student_id
  LEFT JOIN public.schools           sc   ON sc.id      = t.school_id
  LEFT JOIN public.parent_profiles   pp   ON pp.user_id = st.parent_id
  LEFT JOIN public.profiles          pr   ON pr.id      = st.parent_id
  LEFT JOIN public.profiles          cr   ON cr.id      = t.created_by
  LEFT JOIN public.recharge_requests rr   ON rr.id = (t.metadata->>'recharge_request_id')::uuid
  LEFT JOIN public.invoices          inv  ON inv.id = t.invoice_id
  LEFT JOIN LATERAL (
    SELECT ps.id, ps.gateway_reference, ps.parent_id
    FROM public.payment_sessions ps
    WHERE t.id = ANY(ps.debt_tx_ids)
      AND ps.gateway_name = 'izipay'
      AND ps.gateway_status::text = 'success'
      AND ps.status::text = 'completed'
    ORDER BY ps.completed_at DESC NULLS LAST
    LIMIT 1
  ) ps_hit ON TRUE
  LEFT JOIN public.parent_profiles pp_ps ON pp_ps.user_id = ps_hit.parent_id
  WHERE t.id         = p_transaction_id
    AND t.is_deleted = false
    AND (v_my_school IS NULL OR t.school_id = v_my_school);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_debt_payment_bitacora_ticket_detail(uuid)
  TO authenticated;

SELECT 'OK: bitácora — fuente IziPay agregada (voucher + izipay + admin)' AS resultado;
