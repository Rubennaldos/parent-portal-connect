-- ============================================================================
-- FIX PROFESIONAL (rápido) — Responsable de venta con COALESCE por JOIN
-- Fecha: 2026-05-03
--
-- Reglas aplicadas (sin tocar datos):
--   Nivel 1: profiles.full_name por transactions.created_by
--   Nivel 2: nombre del padre (students.parent_id -> profiles.full_name)
--   Nivel 3: "Autogestión: <Alumno>"
--   Final : "Venta Web"
--
-- Objetivo: nunca mostrar "Sistema" en vendedor/registrado_por y mantener
-- rendimiento (sin búsquedas masivas en frontend ni subconsultas por fila).
-- ============================================================================

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
    COALESCE(
      NULLIF(trim(creator.full_name), ''),
      NULLIF(trim(parent.full_name), ''),
      CASE
        WHEN NULLIF(trim(st.full_name), '') IS NOT NULL
          THEN 'Autogestión: ' || trim(st.full_name)
        ELSE NULL
      END,
      'Venta Web'
    )::text                                               AS seller_name,
    t.description::text,
    t.is_deleted
  FROM public.transactions t
  LEFT JOIN public.schools          sc      ON sc.id = t.school_id
  LEFT JOIN public.students         st      ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp      ON tp.id = t.teacher_id
  LEFT JOIN public.profiles         creator ON creator.id = t.created_by
  LEFT JOIN public.profiles         parent  ON parent.id  = st.parent_id
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
      OR (t.metadata->>'num_operacion') ILIKE '%' || p_payment_ref || '%'
    )
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name          ILIKE '%' || p_client_name || '%'
      OR tp.full_name          ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_seller_name IS NULL
      OR COALESCE(
           NULLIF(trim(creator.full_name), ''),
           NULLIF(trim(parent.full_name), ''),
           CASE
             WHEN NULLIF(trim(st.full_name), '') IS NOT NULL
               THEN 'Autogestión: ' || trim(st.full_name)
             ELSE NULL
           END,
           'Venta Web'
         ) ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status)
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ── VENTAS: count_sales_report (mismo criterio de seller_name) ───────────────
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
  LEFT JOIN public.students         st      ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp      ON tp.id = t.teacher_id
  LEFT JOIN public.profiles         creator ON creator.id = t.created_by
  LEFT JOIN public.profiles         parent  ON parent.id  = st.parent_id
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
      OR (t.metadata->>'num_operacion') ILIKE '%' || p_payment_ref || '%'
    )
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name          ILIKE '%' || p_client_name || '%'
      OR tp.full_name          ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_seller_name IS NULL
      OR COALESCE(
           NULLIF(trim(creator.full_name), ''),
           NULLIF(trim(parent.full_name), ''),
           CASE
             WHEN NULLIF(trim(st.full_name), '') IS NOT NULL
               THEN 'Autogestión: ' || trim(st.full_name)
             ELSE NULL
           END,
           'Venta Web'
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
    COALESCE(
      NULLIF(trim(creator.full_name), ''),
      NULLIF(trim(parent.full_name), ''),
      CASE
        WHEN NULLIF(trim(st.full_name), '') IS NOT NULL
          THEN 'Autogestión: ' || trim(st.full_name)
        ELSE NULL
      END,
      'Venta Web'
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
  LEFT JOIN public.schools          sc      ON sc.id = t.school_id
  LEFT JOIN public.students         st      ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp      ON tp.id = t.teacher_id
  LEFT JOIN public.profiles         creator ON creator.id = t.created_by
  LEFT JOIN public.profiles         parent  ON parent.id  = st.parent_id
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
      OR (t.metadata->>'num_operacion') ILIKE '%' || p_reference || '%'
      OR t.ticket_code ILIKE '%' || p_reference || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

SELECT 'Fix rápido profesional: vendedor por COALESCE JOIN aplicado ✅' AS resultado;
