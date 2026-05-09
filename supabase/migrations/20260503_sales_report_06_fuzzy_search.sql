-- ============================================================
-- BLOQUE 1 — Búsqueda Fuzzy + Insensible a Acentos/Mayúsculas
-- ============================================================
-- Requiere extensiones (mismo patrón que 20260409_search_persons_v2.sql):
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- 1. f_unaccent: wrapper IMMUTABLE de unaccent para poder usarlo en índices.
-- 2. Índices GIN trigramados sobre f_unaccent(lower(columna)).
-- 3. Reemplazo de get_sales_report y count_sales_report con nueva lógica
--    de búsqueda: unaccent + lower + LIKE + similarity() > 0.3 para fuzzy.
--
-- Ejemplo: 'Nicolas' → 'Nicolás' (acento), 'NICOLAS' (caps), 'Nicholas' (H muda).
-- ============================================================

-- ── 1. Wrapper IMMUTABLE para unaccent ────────────────────────────────────────
-- En PostgreSQL/contrib, unaccent es de UN solo argumento: public.unaccent(text).
-- NO existe unaccent('unaccent', text) en instalaciones estándar (error 42883).
-- Patrón alineado con normalize_search en 20260409_search_persons_v2.sql.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT public.unaccent($1::text)
$$;

COMMENT ON FUNCTION public.f_unaccent IS
  'Wrapper IMMUTABLE de public.unaccent(text). Permite crear índices de expresión.';

-- ── 2. Índices GIN trigramados (soportan LIKE y similarity) ──────────────────
-- Cubre búsquedas en invoice_client_name (el campo de cliente más frecuente).
CREATE INDEX IF NOT EXISTS idx_tx_invoice_client_fuzzy
  ON public.transactions
  USING gin (public.f_unaccent(lower(invoice_client_name)) gin_trgm_ops)
  WHERE invoice_client_name IS NOT NULL AND is_deleted = false;

-- Cubre ticket_code con ILIKE.
CREATE INDEX IF NOT EXISTS idx_tx_ticket_code_lower
  ON public.transactions
  USING gin (lower(ticket_code) gin_trgm_ops)
  WHERE ticket_code IS NOT NULL;

-- ── 3. get_sales_report con fuzzy ─────────────────────────────────────────────
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
  v_client_q   text;
  v_seller_q   text;
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

  -- Normalizar búsquedas de texto para comparación insensible a acentos/caps.
  v_client_q := CASE WHEN p_client_name IS NOT NULL AND p_client_name <> ''
                     THEN public.f_unaccent(lower(p_client_name)) ELSE NULL END;
  v_seller_q := CASE WHEN p_seller_name IS NOT NULL AND p_seller_name <> ''
                     THEN public.f_unaccent(lower(p_seller_name)) ELSE NULL END;

  RETURN QUERY
  SELECT
    t.id,
    ('OP-' || lpad(t.report_op_seq::text, 6, '0'))::text AS op_code,
    t.report_op_seq,
    t.ticket_code::text,
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
    COALESCE(NULLIF(trim(p.full_name), ''), 'Sistema')::text AS seller_name,
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
    -- Cliente: unaccent+lower LIKE (acentos/caps) + similarity (fuzzy / H muda)
    AND (
      v_client_q IS NULL
      OR public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(st.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(st.full_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(tp.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(tp.full_name, ''))), v_client_q) > 0.3
    )
    -- Vendedor: idem
    AND (
      v_seller_q IS NULL
      OR public.f_unaccent(lower(COALESCE(p.full_name, ''))) LIKE '%' || v_seller_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(p.full_name, ''))), v_seller_q) > 0.3
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status)
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ── 4. count_sales_report con fuzzy ───────────────────────────────────────────
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
  v_client_q   text;
  v_seller_q   text;
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
    EXCEPTION WHEN others THEN v_op_seq := NULL; END;
  END IF;

  v_client_q := CASE WHEN p_client_name IS NOT NULL AND p_client_name <> ''
                     THEN public.f_unaccent(lower(p_client_name)) ELSE NULL END;
  v_seller_q := CASE WHEN p_seller_name IS NOT NULL AND p_seller_name <> ''
                     THEN public.f_unaccent(lower(p_seller_name)) ELSE NULL END;

  SELECT count(*) INTO v_count
  FROM   public.transactions t
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
      v_client_q IS NULL
      OR public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(st.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(st.full_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(tp.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(tp.full_name, ''))), v_client_q) > 0.3
    )
    AND (
      v_seller_q IS NULL
      OR public.f_unaccent(lower(COALESCE(p.full_name, ''))) LIKE '%' || v_seller_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(p.full_name, ''))), v_seller_q) > 0.3
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status);

  RETURN coalesce(v_count, 0);
END;
$$;
