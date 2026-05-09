-- ============================================================================
-- FIX AUDITORÍA HUMANA — Reportes Ventas + Movimientos
-- Fecha: 2026-05-03
--
-- Problema 1 — "Registrado por" siempre muestra 'Sistema':
--   Los pagos de tarjeta/pasarela los aplica el webhook con service_role.
--   created_by apunta a un usuario sin profiles.full_name (o es NULL).
--   Fix: si no hay nombre directo, buscar el nombre del padre a través
--   del student_id de la transacción.
--
-- Problema 2 — Referencia muestra UUIDs ilegibles:
--   gateway_transaction_id es el UUID técnico interno de IziPay (36 chars).
--   El ID legible es gateway_reference_id (GW-20260503-190601) o
--   operation_number corto (código Yape/Plin).
--   Fix: función helper fn_readable_payment_ref con prioridad:
--     1. operation_number corto (≤ 25 chars, no UUID)
--     2. gateway_reference_id si no es UUID
--     3. Metadata: pago_referencia, num_operacion, confirmation_code
--     4. Si solo hay UUID largo → últimos 8 chars con prefijo "…"
--     5. "—"
-- ============================================================================

-- ── Helper: detectar si un string parece un UUID ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_looks_like_uuid(p_val text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT p_val ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- ── Helper: referencia humana de una transacción ──────────────────────────────
-- Prioridad (descendente):
--  1. operation_number corto y NO UUID (Yape, Plin, código manual)
--  2. gateway_reference_id NO UUID (GW-YYYYMMDD-HHMMSS de IziPay)
--  3. metadata->>'pago_referencia'
--  4. metadata->>'num_operacion'
--  5. metadata->>'confirmation_code'
--  6. metadata->>'payment_ref'
--  7. gateway_reference_id UUID → últimos 8 chars con prefijo "…"
--  8. gateway_transaction_id UUID → últimos 8 chars con prefijo "…"
--  9. "—"
CREATE OR REPLACE FUNCTION public.fn_readable_payment_ref(
  p_operation_number   text,
  p_gateway_ref_id     text,
  p_gateway_tx_id      text,
  p_metadata           jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- 1) Número de operación corto y legible (Yape / Plin / manual)
    WHEN p_operation_number IS NOT NULL
         AND length(trim(p_operation_number)) BETWEEN 1 AND 25
         AND NOT public.fn_looks_like_uuid(trim(p_operation_number))
      THEN trim(p_operation_number)

    -- 2) gateway_reference_id legible (ej. GW-20260503-190601)
    WHEN p_gateway_ref_id IS NOT NULL
         AND length(trim(p_gateway_ref_id)) BETWEEN 1 AND 30
         AND NOT public.fn_looks_like_uuid(trim(p_gateway_ref_id))
      THEN trim(p_gateway_ref_id)

    -- 3–6) Campos metadata escritos por el usuario o por la pasarela
    WHEN NULLIF(trim(p_metadata->>'pago_referencia'), '') IS NOT NULL
      THEN trim(p_metadata->>'pago_referencia')
    WHEN NULLIF(trim(p_metadata->>'num_operacion'), '') IS NOT NULL
      THEN trim(p_metadata->>'num_operacion')
    WHEN NULLIF(trim(p_metadata->>'confirmation_code'), '') IS NOT NULL
      THEN trim(p_metadata->>'confirmation_code')
    WHEN NULLIF(trim(p_metadata->>'payment_ref'), '') IS NOT NULL
      THEN trim(p_metadata->>'payment_ref')

    -- 7) gateway_reference_id UUID → truncado legible
    WHEN p_gateway_ref_id IS NOT NULL
         AND public.fn_looks_like_uuid(trim(p_gateway_ref_id))
      THEN '…' || right(trim(p_gateway_ref_id), 8)

    -- 8) gateway_transaction_id UUID → truncado legible
    WHEN p_gateway_tx_id IS NOT NULL
         AND length(trim(p_gateway_tx_id)) > 8
      THEN '…' || right(trim(p_gateway_tx_id), 8)

    -- 9) operation_number largo (UUID) → truncado
    WHEN p_operation_number IS NOT NULL
         AND length(trim(p_operation_number)) > 25
      THEN '…' || right(trim(p_operation_number), 8)

    ELSE '—'
  END;
$$;

COMMENT ON FUNCTION public.fn_readable_payment_ref IS
  'Devuelve la referencia de pago más legible para humanos. '
  'Prioriza códigos cortos (Yape/Plin/manual) sobre UUIDs técnicos de pasarela.';

-- ── get_sales_report con Vendedor real y Referencia legible ───────────────────
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
    EXCEPTION WHEN others THEN v_op_seq := NULL; END;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    ('OP-' || lpad(t.report_op_seq::text, 6, '0'))::text AS op_code,
    t.report_op_seq,
    t.ticket_code::text,
    -- Referencia humana: Yape/Plin corto > GW-ID legible > metadata > UUID truncado
    public.fn_readable_payment_ref(
      t.operation_number::text,
      t.gateway_reference_id::text,
      t.gateway_transaction_id::text,
      t.metadata
    )                                                      AS payment_ref,
    t.amount,
    t.type::text,
    t.payment_method::text,
    t.payment_status::text,
    t.created_at,
    public.get_sales_week_number(t.created_at)             AS week_number,
    sc.name::text                                          AS school_name,
    COALESCE(
      NULLIF(trim(t.invoice_client_name), ''),
      NULLIF(trim(st.full_name), ''),
      NULLIF(trim(tp.full_name), ''),
      'Sin datos'
    )::text                                                AS client_name,
    -- Vendedor real: quien registró → si no hay, buscar padre del alumno
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      (
        SELECT NULLIF(trim(par.full_name), '')
        FROM public.students ss
        JOIN public.profiles par ON par.id = ss.parent_id
        WHERE ss.id = t.student_id
        LIMIT 1
      ),
      NULLIF(trim(tp.full_name), ''),
      'Sistema'
    )::text                                                AS seller_name,
    t.description::text,
    t.is_deleted
  FROM public.transactions t
  LEFT JOIN public.schools          sc ON sc.id = t.school_id
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles          p ON  p.id = t.created_by
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
      OR p.full_name ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status)
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ── count_sales_report ────────────────────────────────────────────────────────
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
    EXCEPTION WHEN others THEN v_op_seq := NULL; END;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.transactions t
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles          p ON  p.id = t.created_by
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
      OR p.full_name ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status);

  RETURN COALESCE(v_count, 0);
END;
$$;

-- ── get_payments_report con Registrado_por real y Referencia legible ──────────
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
    -- Registrado por: creador directo → padre del alumno → profesor → Sistema
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      (
        SELECT NULLIF(trim(par.full_name), '')
        FROM public.students ss
        JOIN public.profiles par ON par.id = ss.parent_id
        WHERE ss.id = t.student_id
        LIMIT 1
      ),
      NULLIF(trim(tp.full_name), ''),
      'Sistema'
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
    -- Referencia legible (sin UUIDs crudos)
    public.fn_readable_payment_ref(
      t.operation_number::text,
      t.gateway_reference_id::text,
      t.gateway_transaction_id::text,
      t.metadata
    )                                                                     AS reference,
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
    AND (p_op_number IS NULL
         OR ('OP-' || lpad(t.report_op_seq::text, 6, '0')) ILIKE '%' || p_op_number || '%')
    AND (p_ticket_number IS NULL OR t.ticket_code ILIKE '%' || p_ticket_number || '%')
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

-- ── count_payments_report ─────────────────────────────────────────────────────
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
    AND (p_op_number IS NULL
         OR ('OP-' || lpad(t.report_op_seq::text, 6, '0')) ILIKE '%' || p_op_number || '%')
    AND (p_ticket_number IS NULL OR t.ticket_code ILIKE '%' || p_ticket_number || '%')
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
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

SELECT 'Auditoría humana aplicada: nombres reales + referencias legibles ✅' AS resultado;
