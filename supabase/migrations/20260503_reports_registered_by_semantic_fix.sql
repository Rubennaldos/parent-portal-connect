-- ============================================================================
-- FIX URGENTE AUDITORÍA: vendedor/registrado_por semántico y legible
-- Fecha: 2026-05-03
--
-- Objetivo:
-- 1) Si created_by tiene full_name en profiles -> usar SIEMPRE ese nombre.
-- 2) Si es compra del portal/padre -> mostrar "Realizado por el padre".
-- 3) Si es flujo web sin vendedor físico -> mostrar "Portal de Padres".
-- 4) Si es ticket kiosco (T-...) sin nombre -> marcar inconsistencia:
--    "Vendedor no identificado (kiosco)".
-- ============================================================================

-- ── Helper: resolver nombre de responsable humano para reportes ──────────────
CREATE OR REPLACE FUNCTION public.fn_resolve_registered_by(
  p_created_by      uuid,
  p_student_id      uuid,
  p_ticket_code     text,
  p_payment_method  text,
  p_gateway_ref_id  text,
  p_metadata        jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_name text;
  v_source       text;
  v_source_chan  text;
BEGIN
  -- 1) Prioridad absoluta: nombre real del empleado/usuario que registró.
  SELECT NULLIF(trim(p.full_name), '')
  INTO v_profile_name
  FROM public.profiles p
  WHERE p.id = p_created_by
  LIMIT 1;

  IF v_profile_name IS NOT NULL THEN
    RETURN v_profile_name;
  END IF;

  v_source      := lower(COALESCE(p_metadata->>'source', ''));
  v_source_chan := lower(COALESCE(p_metadata->>'source_channel', ''));

  -- 2) Flujo explícito de padre/portal.
  IF v_source_chan = 'parent_web'
     OR v_source LIKE '%parent%'
     OR v_source LIKE '%unified_payment%'
     OR v_source LIKE '%gateway%'
  THEN
    RETURN 'Realizado por el padre';
  END IF;

  -- 3) Compra web/pasarela (sin vendedor físico en caja).
  IF COALESCE(p_gateway_ref_id, '') ILIKE 'GW-%'
     OR lower(COALESCE(p_payment_method, '')) = 'tarjeta'
  THEN
    RETURN 'Portal de Padres';
  END IF;

  -- 4) Ticket kiosco sin nombre (alerta de calidad de datos).
  IF COALESCE(p_ticket_code, '') ILIKE 'T-%' THEN
    RETURN 'Vendedor no identificado (kiosco)';
  END IF;

  -- Fallback final.
  RETURN 'Sistema';
END;
$$;

COMMENT ON FUNCTION public.fn_resolve_registered_by IS
  'Resuelve el responsable visible en reportes: empleado real > padre > portal > alerta kiosco > sistema.';

-- ── VENTAS: get_sales_report ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_report(
  p_school_id       uuid    DEFAULT NULL,
  p_date_from       text    DEFAULT NULL,
  p_date_to         text    DEFAULT NULL,
  p_ticket_code     text    DEFAULT NULL,
  p_op_code         text    DEFAULT NULL,
  p_payment_ref     text    DEFAULT NULL,
  p_client_name     text    DEFAULT NULL,
  p_seller_name     text    DEFAULT NULL,
  p_payment_method  text    DEFAULT NULL,
  p_payment_status  text    DEFAULT NULL,
  p_include_deleted boolean DEFAULT false,
  p_limit           integer DEFAULT 50,
  p_offset          integer DEFAULT 0
)
RETURNS SETOF public.sales_report_row
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from  timestamptz;
  v_date_to    timestamptz;
  v_op_seq     bigint;
BEGIN
  PERFORM public.fn_assert_admin_general();

  IF p_date_from IS NOT NULL THEN
    v_date_from := (p_date_from || 'T00:00:00')::timestamp AT TIME ZONE 'America/Lima';
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_date_to := (p_date_to || 'T23:59:59')::timestamp AT TIME ZONE 'America/Lima';
  END IF;
  IF p_op_code IS NOT NULL AND p_op_code <> '' THEN
    BEGIN
      v_op_seq := regexp_replace(upper(p_op_code), '[^0-9]', '', 'g')::bigint;
    EXCEPTION WHEN others THEN
      v_op_seq := NULL;
    END;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    ('OP-' || lpad(t.report_op_seq::text, 6, '0'))::text AS op_code,
    t.report_op_seq,
    t.ticket_code::text                                   AS ticket_code,
    public.fn_readable_payment_ref(
      t.operation_number::text,
      t.gateway_reference_id::text,
      t.gateway_transaction_id::text,
      t.metadata
    )::text                                               AS payment_ref,
    t.amount,
    t.type::text,
    t.payment_method::text,
    t.payment_status::text,
    t.created_at,
    public.get_sales_week_number(t.created_at)            AS week_number,
    sc.name::text                                         AS school_name,
    COALESCE(
      NULLIF(trim(t.invoice_client_name), ''),
      NULLIF(trim(st.full_name), ''),
      NULLIF(trim(tp.full_name), ''),
      'Sin datos'
    )::text                                               AS client_name,
    public.fn_resolve_registered_by(
      t.created_by,
      t.student_id,
      t.ticket_code::text,
      t.payment_method::text,
      t.gateway_reference_id::text,
      t.metadata
    )::text                                               AS seller_name,
    t.description::text,
    t.is_deleted
  FROM public.transactions t
  LEFT JOIN public.schools          sc ON sc.id = t.school_id
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  WHERE
    (p_include_deleted OR coalesce(t.is_deleted, false) = false)
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
    AND (v_date_from IS NULL OR t.created_at >= v_date_from)
    AND (v_date_to   IS NULL OR t.created_at <= v_date_to)
    AND (p_ticket_code IS NULL OR t.ticket_code ILIKE '%' || p_ticket_code || '%')
    AND (v_op_seq IS NULL OR t.report_op_seq = v_op_seq)
    AND (
      p_payment_ref IS NULL
      OR t.operation_number ILIKE '%' || p_payment_ref || '%'
      OR t.gateway_reference_id ILIKE '%' || p_payment_ref || '%'
      OR (t.metadata->>'pago_referencia') ILIKE '%' || p_payment_ref || '%'
    )
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name          ILIKE '%' || p_client_name || '%'
      OR tp.full_name          ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_seller_name IS NULL
      OR public.fn_resolve_registered_by(
           t.created_by,
           t.student_id,
           t.ticket_code::text,
           t.payment_method::text,
           t.gateway_reference_id::text,
           t.metadata
         ) ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status)
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ── VENTAS: count_sales_report ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_sales_report(
  p_school_id       uuid    DEFAULT NULL,
  p_date_from       text    DEFAULT NULL,
  p_date_to         text    DEFAULT NULL,
  p_ticket_code     text    DEFAULT NULL,
  p_op_code         text    DEFAULT NULL,
  p_payment_ref     text    DEFAULT NULL,
  p_client_name     text    DEFAULT NULL,
  p_seller_name     text    DEFAULT NULL,
  p_payment_method  text    DEFAULT NULL,
  p_payment_status  text    DEFAULT NULL,
  p_include_deleted boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from timestamptz;
  v_date_to   timestamptz;
  v_op_seq    bigint;
  v_count     bigint;
BEGIN
  PERFORM public.fn_assert_admin_general();

  IF p_date_from IS NOT NULL THEN
    v_date_from := (p_date_from || 'T00:00:00')::timestamp AT TIME ZONE 'America/Lima';
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_date_to := (p_date_to || 'T23:59:59')::timestamp AT TIME ZONE 'America/Lima';
  END IF;
  IF p_op_code IS NOT NULL AND p_op_code <> '' THEN
    BEGIN
      v_op_seq := regexp_replace(upper(p_op_code), '[^0-9]', '', 'g')::bigint;
    EXCEPTION WHEN others THEN
      v_op_seq := NULL;
    END;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.transactions t
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  WHERE
    (p_include_deleted OR coalesce(t.is_deleted, false) = false)
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
    AND (v_date_from IS NULL OR t.created_at >= v_date_from)
    AND (v_date_to   IS NULL OR t.created_at <= v_date_to)
    AND (p_ticket_code IS NULL OR t.ticket_code ILIKE '%' || p_ticket_code || '%')
    AND (v_op_seq IS NULL OR t.report_op_seq = v_op_seq)
    AND (
      p_payment_ref IS NULL
      OR t.operation_number ILIKE '%' || p_payment_ref || '%'
      OR t.gateway_reference_id ILIKE '%' || p_payment_ref || '%'
      OR (t.metadata->>'pago_referencia') ILIKE '%' || p_payment_ref || '%'
    )
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name          ILIKE '%' || p_client_name || '%'
      OR tp.full_name          ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_seller_name IS NULL
      OR public.fn_resolve_registered_by(
           t.created_by,
           t.student_id,
           t.ticket_code::text,
           t.payment_method::text,
           t.gateway_reference_id::text,
           t.metadata
         ) ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status);

  RETURN COALESCE(v_count, 0);
END;
$$;

-- ── MOVIMIENTOS: get_payments_report ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_payments_report(
  p_school_id      uuid    DEFAULT NULL,
  p_date_from      text    DEFAULT NULL,
  p_date_to        text    DEFAULT NULL,
  p_op_number      text    DEFAULT NULL,
  p_ticket_number  text    DEFAULT NULL,
  p_client_name    text    DEFAULT NULL,
  p_reference      text    DEFAULT NULL,
  p_payment_method text    DEFAULT NULL,
  p_week_number    integer DEFAULT NULL,
  p_limit          integer DEFAULT 50,
  p_offset         integer DEFAULT 0
)
RETURNS SETOF public.payments_report_row
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from  timestamptz;
  v_date_to    timestamptz;
BEGIN
  PERFORM public.fn_assert_admin_general();

  IF p_week_number IS NOT NULL THEN
    v_date_from := ('2025-12-29'::date + ((p_week_number - 1) * 7) * interval '1 day') AT TIME ZONE 'America/Lima';
    v_date_to   := v_date_from + interval '7 days' - interval '1 second';
  ELSE
    IF p_date_from IS NOT NULL THEN
      v_date_from := (p_date_from || 'T00:00:00')::timestamp AT TIME ZONE 'America/Lima';
    END IF;
    IF p_date_to IS NOT NULL THEN
      v_date_to := (p_date_to || 'T23:59:59')::timestamp AT TIME ZONE 'America/Lima';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    COALESCE('OP-' || lpad(t.report_op_seq::text, 6, '0'), '—')::text    AS op_number,
    COALESCE(t.ticket_code::text, '—')                                    AS ticket_number,
    to_char(t.created_at AT TIME ZONE 'America/Lima', 'DD/MM/YYYY')::text AS payment_date,
    to_char(t.created_at AT TIME ZONE 'America/Lima', 'HH24:MI')::text    AS payment_time,
    public.get_sales_week_number(t.created_at)                            AS week_number,
    public.fn_resolve_registered_by(
      t.created_by,
      t.student_id,
      t.ticket_code::text,
      t.payment_method::text,
      t.gateway_reference_id::text,
      t.metadata
    )::text                                                               AS registered_by,
    COALESCE(
      NULLIF(trim(t.invoice_client_name), ''),
      NULLIF(trim(st.full_name), ''),
      NULLIF(trim(tp.full_name), ''),
      'Sin datos'
    )::text                                                               AS client_name,
    ABS(t.amount)                                                         AS amount,
    COALESCE(t.payment_method::text, '—')                                 AS payment_method,
    COALESCE(t.payment_status::text, '—')                                 AS payment_status,
    public.fn_readable_payment_ref(
      t.operation_number::text,
      t.gateway_reference_id::text,
      t.gateway_transaction_id::text,
      t.metadata
    )::text                                                               AS reference,
    COALESCE(sc.name::text, '—')                                          AS school_name,
    COALESCE(t.description::text, '—')                                    AS description
  FROM public.transactions t
  LEFT JOIN public.schools          sc ON sc.id = t.school_id
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  WHERE
    coalesce(t.is_deleted, false) = false
    AND t.payment_status IN ('paid', 'completed')
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
    AND (v_date_from IS NULL OR t.created_at >= v_date_from)
    AND (v_date_to   IS NULL OR t.created_at <= v_date_to)
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (
      p_op_number IS NULL
      OR ('OP-' || lpad(t.report_op_seq::text, 6, '0')) ILIKE '%' || p_op_number || '%'
    )
    AND (
      p_ticket_number IS NULL
      OR t.ticket_code ILIKE '%' || p_ticket_number || '%'
    )
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name           ILIKE '%' || p_client_name || '%'
      OR tp.full_name           ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_reference IS NULL
      OR t.operation_number ILIKE '%' || p_reference || '%'
      OR t.gateway_reference_id ILIKE '%' || p_reference || '%'
      OR (t.metadata->>'pago_referencia') ILIKE '%' || p_reference || '%'
      OR t.ticket_code ILIKE '%' || p_reference || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

SELECT 'Fix semántico de vendedor/registrado_por aplicado ✅' AS resultado;
