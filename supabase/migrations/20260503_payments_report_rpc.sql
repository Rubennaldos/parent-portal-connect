-- ============================================================================
-- Reporte de Movimientos / Pagos: get_payments_report + count_payments_report
-- Fecha: 2026-05-03
--
-- Devuelve las transacciones con payment_status = 'paid' / 'completed'
-- enriquecidas con datos de auditoría: quién registró, a qué hora exacta,
-- referencia bancaria y nombre del cliente/alumno.
--
-- Seguridad:
--   SECURITY DEFINER: la función accede a transactions aunque la policy
--   restrictiva de reportes solo abra SELECT a admin_general.
--   fn_assert_admin_general() bloquea a cualquier otro rol antes de ejecutar.
--
-- Fuzzy search:
--   p_client_name y p_reference usan ILIKE '%…%' (trigram GIN disponible).
-- ============================================================================

-- ── Tipo de retorno ────────────────────────────────────────────────────────────
DROP TYPE IF EXISTS public.payments_report_row CASCADE;

CREATE TYPE public.payments_report_row AS (
  id               uuid,
  op_number        text,      -- 'OP-000001' (report_op_seq)
  ticket_number    text,      -- ticket_code operativo por sede
  payment_date     text,      -- 'DD/MM/YYYY' en America/Lima
  payment_time     text,      -- 'HH:MM'      en America/Lima
  week_number      integer,   -- semana operativa Beto
  registered_by    text,      -- profiles.full_name del created_by
  client_name      text,      -- alumno / profesor / factura / sin datos
  amount           numeric,   -- siempre positivo para el reporte
  payment_method   text,
  payment_status   text,
  reference        text,      -- operation_number (Yape, Plin, transferencia…)
  school_name      text,
  description      text
);

-- ── get_payments_report ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_payments_report(
  p_school_id      uuid    DEFAULT NULL,
  p_date_from      text    DEFAULT NULL,   -- 'YYYY-MM-DD'
  p_date_to        text    DEFAULT NULL,   -- 'YYYY-MM-DD'
  p_client_name    text    DEFAULT NULL,   -- fuzzy ILIKE
  p_reference      text    DEFAULT NULL,   -- fuzzy sobre operation_number
  p_payment_method text    DEFAULT NULL,
  p_week_number    integer DEFAULT NULL,   -- semana operativa Beto
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

  -- Semana operativa tiene prioridad sobre fechas sueltas
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
    -- N° operación global de auditoría
    COALESCE('OP-' || lpad(t.report_op_seq::text, 6, '0'), '—')    AS op_number,
    COALESCE(t.ticket_code, '—')                                    AS ticket_number,
    -- Fecha y hora separadas en zona Lima
    to_char(t.created_at AT TIME ZONE 'America/Lima', 'DD/MM/YYYY') AS payment_date,
    to_char(t.created_at AT TIME ZONE 'America/Lima', 'HH24:MI')    AS payment_time,
    public.get_sales_week_number(t.created_at)                      AS week_number,
    -- Quien registró
    COALESCE(NULLIF(trim(p.full_name), ''), 'Sistema')              AS registered_by,
    -- Nombre del cliente
    COALESCE(
      NULLIF(trim(t.invoice_client_name), ''),
      NULLIF(trim(st.full_name), ''),
      NULLIF(trim(tp.full_name), ''),
      'Sin datos'
    )::text                                                         AS client_name,
    -- Monto siempre positivo
    ABS(t.amount)                                                   AS amount,
    COALESCE(t.payment_method, '—')                                 AS payment_method,
    COALESCE(t.payment_status, '—')                                 AS payment_status,
    -- Referencia bancaria (Yape/Plin/Transferencia)
    COALESCE(t.operation_number, '—')                               AS reference,
    COALESCE(sc.name, '—')                                          AS school_name,
    COALESCE(t.description, '—')                                    AS description
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
    -- Fuzzy cliente (trigram GIN disponible en invoice_client_name)
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name           ILIKE '%' || p_client_name || '%'
      OR tp.full_name           ILIKE '%' || p_client_name || '%'
    )
    -- Fuzzy referencia
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

-- ── count_payments_report ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_payments_report(
  p_school_id      uuid    DEFAULT NULL,
  p_date_from      text    DEFAULT NULL,
  p_date_to        text    DEFAULT NULL,
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
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name           ILIKE '%' || p_client_name || '%'
      OR tp.full_name           ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_reference IS NULL
      OR t.operation_number ILIKE '%' || p_reference || '%'
      OR t.ticket_code      ILIKE '%' || p_reference || '%'
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_payments_report   TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_payments_report TO authenticated;

SELECT 'get_payments_report + count_payments_report instalados ✅' AS resultado;
