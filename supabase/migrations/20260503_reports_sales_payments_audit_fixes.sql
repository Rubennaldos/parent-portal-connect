-- ============================================================================
-- FIX AUDITORIA REPORTES (Ventas + Movimientos)
-- Fecha: 2026-05-03
--
-- Objetivos:
-- 1) Mostrar "Vendedor / Registrado por" desde profiles.full_name con JOIN por created_by.
-- 2) Mapear referencia de pago correctamente usando transactions.operation_number
--    con fallback a metadata.gateway_reference_id si aplica.
-- 3) Movimientos: agregar filtros por N° OP y Ticket (búsqueda parcial).
-- 4) Mantener semana operativa y filtro global de fecha coexistiendo.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- VENTAS: get_sales_report
-- ─────────────────────────────────────────────────────────────────────────────
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
    COALESCE(
      NULLIF(trim(t.operation_number::text), ''),
      NULLIF(trim(t.metadata->>'operation_number'), ''),
      NULLIF(trim(t.gateway_reference_id::text), ''),
      '—'
    )::text                                               AS payment_ref,
    t.amount,
    t.type::text,
    t.payment_method::text,
    t.payment_status::text,
    t.created_at,
    public.get_sales_week_number(t.created_at)           AS week_number,
    sc.name::text                                         AS school_name,
    COALESCE(
      NULLIF(trim(t.invoice_client_name), ''),
      NULLIF(trim(st.full_name), ''),
      NULLIF(trim(tp.full_name), ''),
      'Sin datos'
    )::text                                               AS client_name,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      'Sistema'
    )::text                                               AS seller_name,
    t.description::text,
    t.is_deleted
  FROM public.transactions t
  LEFT JOIN public.schools          sc ON sc.id = t.school_id
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles          p ON p.id  = t.created_by
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
      OR (t.metadata->>'operation_number') ILIKE '%' || p_payment_ref || '%'
      OR t.gateway_reference_id ILIKE '%' || p_payment_ref || '%'
    )
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name          ILIKE '%' || p_client_name || '%'
      OR tp.full_name          ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_seller_name IS NULL
      OR p.full_name ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status)
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VENTAS: count_sales_report
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_date_from  timestamptz;
  v_date_to    timestamptz;
  v_op_seq     bigint;
  v_count      bigint;
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
  LEFT JOIN public.profiles          p ON p.id  = t.created_by
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
      OR (t.metadata->>'operation_number') ILIKE '%' || p_payment_ref || '%'
      OR t.gateway_reference_id ILIKE '%' || p_payment_ref || '%'
    )
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name          ILIKE '%' || p_client_name || '%'
      OR tp.full_name          ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_seller_name IS NULL
      OR p.full_name ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status);

  RETURN COALESCE(v_count, 0);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- MOVIMIENTOS: get_payments_report (agrega filtros OP/Ticket + referencia robusta)
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Semana operativa mantiene prioridad si viene informada.
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
    COALESCE(NULLIF(trim(p.full_name), ''), 'Sistema')::text              AS registered_by,
    COALESCE(
      NULLIF(trim(t.invoice_client_name), ''),
      NULLIF(trim(st.full_name), ''),
      NULLIF(trim(tp.full_name), ''),
      'Sin datos'
    )::text                                                               AS client_name,
    ABS(t.amount)                                                         AS amount,
    COALESCE(t.payment_method::text, '—')                                 AS payment_method,
    COALESCE(t.payment_status::text, '—')                                 AS payment_status,
    COALESCE(
      NULLIF(trim(t.operation_number::text), ''),
      NULLIF(trim(t.metadata->>'operation_number'), ''),
      NULLIF(trim(t.gateway_reference_id::text), ''),
      '—'
    )::text                                                               AS reference,
    COALESCE(sc.name::text, '—')                                          AS school_name,
    COALESCE(t.description::text, '—')                                    AS description
  FROM public.transactions t
  LEFT JOIN public.schools          sc ON sc.id = t.school_id
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles          p ON p.id  = t.created_by
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
      OR (t.metadata->>'operation_number') ILIKE '%' || p_reference || '%'
      OR t.gateway_reference_id ILIKE '%' || p_reference || '%'
      OR t.ticket_code ILIKE '%' || p_reference || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- MOVIMIENTOS: count_payments_report (misma lógica de filtros)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_payments_report(
  p_school_id      uuid    DEFAULT NULL,
  p_date_from      text    DEFAULT NULL,
  p_date_to        text    DEFAULT NULL,
  p_op_number      text    DEFAULT NULL,
  p_ticket_number  text    DEFAULT NULL,
  p_client_name    text    DEFAULT NULL,
  p_reference      text    DEFAULT NULL,
  p_payment_method text    DEFAULT NULL,
  p_week_number    integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from timestamptz;
  v_date_to   timestamptz;
  v_count     bigint;
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

  SELECT count(*)
  INTO   v_count
  FROM public.transactions t
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
      OR (t.metadata->>'operation_number') ILIKE '%' || p_reference || '%'
      OR t.gateway_reference_id ILIKE '%' || p_reference || '%'
      OR t.ticket_code ILIKE '%' || p_reference || '%'
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

SELECT 'RPCs de Ventas/Movimientos ajustados para auditoría ✅' AS resultado;
