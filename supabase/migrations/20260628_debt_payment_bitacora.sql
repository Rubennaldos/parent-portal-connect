-- ============================================================================
-- BITÁCORA DE PAGOS DE DEUDA — 20260628
--
-- 4 funciones de solo lectura (sin impacto en saldos, pasarela ni triggers).
-- Reglas de oro respetadas:
--   · SECURITY DEFINER + guard de rol al inicio (admin_general, gestor_unidad)
--   · gestor_unidad: school_id forzado desde la BD — nunca del parámetro
--   · Cero cálculos financieros en frontend; todo viene del RPC
--   · Fechas en America/Lima (PostgreSQL now() AT TIME ZONE)
--   · No se tocan saldos, pasarela, triggers ni tablas críticas
--
-- Fuentes:
--   A) recharge_requests aprobados (debt_payment / lunch_payment) — voucher del padre
--   B) transactions pagadas por admin sin voucher asociado — cobro directo en caja
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. list_debt_payment_bitacora
--    Lista paginada de eventos de pago. Un evento = un pago (puede cubrir N boletas).
--    Ordenado por fecha desc. Solo carga la cabecera; las boletas se piden aparte.
-- ─────────────────────────────────────────────────────────────────────────────

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
  event_id         text,         -- opaque key devuelto al cliente para pedir boletas
  event_type       text,         -- 'voucher' | 'admin_group' | 'admin_single'
  event_ts         timestamptz,  -- fecha del evento (aprobación / registro)
  amount           numeric,      -- monto total del evento (S/)
  student_name     text,         -- nombre del alumno (null si grupo multi-alumno)
  student_count    int,          -- nro de alumnos distintos cubiertos
  school_name      text,
  school_id        uuid,
  payment_method   text,         -- yape, tarjeta, efectivo, etc.
  operation_number text,         -- nro de referencia (Yape #XXXX, etc.)
  ticket_count     int,          -- cuántas boletas cubre este pago
  parent_name      text,         -- nullable — solo vouchers del padre
  parent_email     text,         -- nullable — solo vouchers del padre
  collector_name   text,         -- quien aprobó (voucher) o registró (admin directo)
  collector_email  text,
  voucher_url      text          -- foto del comprobante del padre (nullable)
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
  -- ── Guard de rol ────────────────────────────────────────────────────────────
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Acceso restringido a administradores';
  END IF;

  -- ── Gestor: forzar a su sede (ignorar lo que envíe el frontend) ──────────
  IF v_caller_role = 'gestor_unidad' THEN
    SELECT school_id INTO v_school_id FROM public.profiles WHERE id = auth.uid();
  END IF;

  -- ── Normalizar término de búsqueda ──────────────────────────────────────
  IF p_search_term IS NOT NULL AND TRIM(p_search_term) <> '' THEN
    v_search := '%' || TRIM(p_search_term) || '%';
  END IF;

  RETURN QUERY
  WITH
  -- ── Fuente A: Vouchers del padre (debt_payment / lunch_payment aprobados) ─
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

  -- ── Fuente B1: Cobros directos del admin con operation_number ─────────────
  --    Se agrupan en un evento por (operation_number + admin + día Lima).
  --    event_id codificado como "op|||uuid|||YYYY-MM-DD"
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

  -- ── Fuente B2: Cobros directos del admin SIN operation_number ─────────────
  --    Cada transacción es su propio evento.
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
      t.ticket_code::text                                                  AS operation_number,
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
      AND (v_school_id    IS NULL OR t.school_id  = v_school_id)
      AND (p_date_from    IS NULL OR t.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR t.created_at <= p_date_to)
      AND (p_collector_id IS NULL OR t.created_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name  ILIKE v_search
        OR cr.full_name  ILIKE v_search
        OR t.ticket_code ILIKE v_search
      )
  )

  SELECT * FROM (
    SELECT * FROM src_voucher
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
  'Bitácora de pagos de deuda: lista paginada de eventos (voucher padre + cobro admin). '
  'SECURITY DEFINER: gestor_unidad solo ve su sede (forzado en SQL).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. count_debt_payment_bitacora
--    Mismo filtro que list_debt_payment_bitacora pero solo devuelve el conteo.
--    Necesario para la paginación en el frontend.
-- ─────────────────────────────────────────────────────────────────────────────

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
      AND (v_school_id    IS NULL OR t.school_id  = v_school_id)
      AND (p_date_from    IS NULL OR t.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR t.created_at <= p_date_to)
      AND (p_collector_id IS NULL OR t.created_by  = p_collector_id)
      AND (
        v_search IS NULL
        OR st.full_name  ILIKE v_search
        OR cr.full_name  ILIKE v_search
        OR t.ticket_code ILIKE v_search
      )
  )
  SELECT (SELECT n FROM cnt_voucher) + (SELECT n FROM cnt_admin_group) + (SELECT n FROM cnt_admin_single)
  INTO v_total;

  RETURN COALESCE(v_total, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_debt_payment_bitacora(uuid, timestamptz, timestamptz, text, uuid)
  TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_debt_payment_bitacora_tickets
--    Carga lazy: devuelve las boletas de UN evento específico.
--    Se llama solo cuando el usuario abre el acordeón de un evento.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_debt_payment_bitacora_tickets(text, text);

CREATE OR REPLACE FUNCTION public.get_debt_payment_bitacora_tickets(
  p_event_id   text,
  p_event_type text  -- 'voucher' | 'admin_group' | 'admin_single'
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
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Acceso restringido a administradores';
  END IF;

  IF v_caller_role = 'gestor_unidad' THEN
    SELECT school_id INTO v_my_school FROM public.profiles WHERE id = auth.uid();
  END IF;

  -- ── Voucher del padre ────────────────────────────────────────────────────
  IF p_event_type = 'voucher' THEN

    SELECT paid_transaction_ids, lunch_order_ids, school_id
    INTO   v_paid_tx_ids, v_lunch_ids, v_rr_school
    FROM   public.recharge_requests
    WHERE  id = p_event_id::uuid;

    IF NOT FOUND THEN RETURN; END IF;

    -- Gestor no puede ver boletas de otras sedes
    IF v_my_school IS NOT NULL AND v_rr_school <> v_my_school THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Esta solicitud pertenece a otra sede';
    END IF;

    RETURN QUERY
    SELECT DISTINCT ON (t.id)
      t.id,
      t.ticket_code::text,
      ABS(t.amount),
      COALESCE(t.description, '')::text,
      (t.metadata->>'lunch_order_id' IS NOT NULL),
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

  -- ── Cobro admin agrupado (event_id = "op|||uuid|||YYYY-MM-DD") ───────────
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
      (t.metadata->>'lunch_order_id' IS NOT NULL),
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

  -- ── Cobro admin individual (event_id = transaction uuid) ─────────────────
  ELSIF p_event_type = 'admin_single' THEN

    RETURN QUERY
    SELECT
      t.id,
      t.ticket_code::text,
      ABS(t.amount),
      COALESCE(t.description, '')::text,
      (t.metadata->>'lunch_order_id' IS NOT NULL),
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

COMMENT ON FUNCTION public.get_debt_payment_bitacora_tickets IS
  'Carga lazy: boletas de un evento de la bitácora. '
  'Soporta voucher (recharge_request), admin_group (agrupado) y admin_single.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_debt_payment_bitacora_ticket_detail
--    Detalle completo de UNA boleta: alumno, padre, admin, medio, SUNAT.
--    Se llama solo cuando el usuario toca una boleta específica.
-- ─────────────────────────────────────────────────────────────────────────────

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
  voucher_url      text,     -- foto del comprobante del padre (si aplica)
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
    t.payment_method::text,
    t.operation_number::text,
    t.created_at,
    (t.metadata->>'lunch_order_id' IS NOT NULL),
    st.full_name::text                                                      AS student_name,
    COALESCE(NULLIF(TRIM(pp.full_name), ''), pr.full_name)::text            AS parent_name,
    COALESCE(NULLIF(TRIM(pp.email),     ''), pr.email)::text               AS parent_email,
    sc.name::text                                                           AS school_name,
    cr.full_name::text                                                      AS collector_name,
    cr.email::text                                                          AS collector_email,
    COALESCE(
      t.metadata->>'voucher_url',
      rr.voucher_url
    )::text                                                                  AS voucher_url,
    t.invoice_id,
    inv.pdf_url::text                                                        AS invoice_pdf_url
  FROM public.transactions t
  LEFT JOIN public.students          st  ON st.id      = t.student_id
  LEFT JOIN public.schools           sc  ON sc.id      = t.school_id
  LEFT JOIN public.parent_profiles   pp  ON pp.user_id = st.parent_id
  LEFT JOIN public.profiles          pr  ON pr.id      = st.parent_id
  LEFT JOIN public.profiles          cr  ON cr.id      = t.created_by
  LEFT JOIN public.recharge_requests rr  ON rr.id = (t.metadata->>'recharge_request_id')::uuid
  LEFT JOIN public.invoices          inv ON inv.id = t.invoice_id
  WHERE t.id         = p_transaction_id
    AND t.is_deleted = false
    AND (v_my_school IS NULL OR t.school_id = v_my_school);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_debt_payment_bitacora_ticket_detail(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_debt_payment_bitacora_ticket_detail IS
  'Detalle completo de una boleta: alumno, padre (nombre + email), '
  'admin (nombre + email), medio de pago, foto comprobante, SUNAT.';


SELECT 'OK: bitácora de pagos de deuda — 4 funciones creadas' AS resultado;
