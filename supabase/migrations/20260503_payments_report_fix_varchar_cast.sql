-- ============================================================================
-- FIX: get_payments_report — alinear tipos varchar → text
-- Error: "Returned type character varying does not match expected type text"
-- Las columnas ticket_code, payment_method, payment_status, operation_number
-- y schools.name son varchar en la BD; el tipo compuesto declara text.
-- Solución: ::text explícito en cada columna afectada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_payments_report(
  p_school_id      uuid    DEFAULT NULL,
  p_date_from      text    DEFAULT NULL,
  p_date_to        text    DEFAULT NULL,
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
    v_date_from := (
      '2025-12-29'::date + ((p_week_number - 1) * 7) * interval '1 day'
    ) AT TIME ZONE 'America/Lima';
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
    COALESCE(t.operation_number::text, '—')                               AS reference,
    COALESCE(sc.name::text, '—')                                          AS school_name,
    COALESCE(t.description::text, '—')                                    AS description
  FROM public.transactions t
  LEFT JOIN public.schools          sc ON sc.id = t.school_id
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles          p ON  p.id = t.created_by
  WHERE
    coalesce(t.is_deleted, false) = false
    AND t.payment_status IN ('paid', 'completed')
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
    AND (v_date_from IS NULL OR t.created_at >= v_date_from)
    AND (v_date_to   IS NULL OR t.created_at <= v_date_to)
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name           ILIKE '%' || p_client_name || '%'
      OR tp.full_name           ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_reference IS NULL
      OR t.operation_number ILIKE '%' || p_reference || '%'
      OR t.ticket_code      ILIKE '%' || p_reference || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

SELECT 'get_payments_report fix varchar→text aplicado ✅' AS resultado;
