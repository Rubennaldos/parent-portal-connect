-- ============================================================
-- BLOQUE 1 — Reglas de negocio del Reporte de Ventas
-- ============================================================
-- 1. get_sales_week_number: usa el calendario operativo de Beto.
--    Semana 1 = Lunes 29/12/2025.
--    Cada lunes inicia una nueva semana.
-- 2. get_sales_report: seller_name fallback → 'Sistema' (no email).
-- ============================================================

-- ── 1. Semana operativa Beto ────────────────────────────────────────────────
-- Fórmula:
--   v_days = (fecha Lima) - (2025-12-29)::date  → en PG es INTEGER (días calendario)
--   semana = FLOOR(v_days / 7) + 1
-- Nota: NO usar EXTRACT(EPOCH FROM (date - date)): date-date devuelve integer, no interval.
-- GREATEST(..., 1) para que fechas anteriores al epoch devuelvan Semana 1.
CREATE OR REPLACE FUNCTION public.get_sales_week_number(p_ts timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    FLOOR(
      (
        date_trunc('day', p_ts AT TIME ZONE 'America/Lima')::date
        - '2025-12-29'::date
      )::numeric / 7.0
    )::integer + 1,
    1
  );
$$;

COMMENT ON FUNCTION public.get_sales_week_number IS
  'Semana operativa Lima Café 28. Semana 1 = lunes 29/12/2025. '
  'Incrementa cada lunes. Zona horaria: America/Lima (UTC-5, sin DST).';

-- ── 2. Reemplazar get_sales_report con seller fallback 'Sistema' ────────────
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
    t.operation_number::text                              AS payment_ref,
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
    -- Seller: full_name del perfil, fallback 'Sistema' (no email)
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
    AND (p_payment_ref IS NULL OR t.operation_number ILIKE '%' || p_payment_ref || '%')
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
