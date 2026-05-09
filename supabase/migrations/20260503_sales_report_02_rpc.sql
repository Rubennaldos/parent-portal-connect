-- ============================================================
-- BLOQUE 1 — RPC Reporte de Ventas
-- ============================================================
-- get_sales_report      → filas paginadas con todos los joins
-- count_sales_report    → total de filas para paginación
--
-- Ambas usan SECURITY DEFINER para acceder a las tablas incluso
-- con las policies RLS restrictivas del módulo de reportes.
-- El acceso se valida explícitamente en el cuerpo de la función.
--
-- Separación de identidades en la respuesta:
--   op_code       → 'OP-000001'  (audit global, report_op_seq)
--   ticket_code   → 'T-AN-007833' (identidad operativa por sede)
--   payment_ref   → referencia de pago digital (operation_number: Yape/Plin/etc.)
-- ============================================================

-- ── Helper: check admin_general desde SECURITY DEFINER ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_assert_admin_general()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF coalesce((auth.jwt() ->> 'role'), '') <> 'admin_general' THEN
    RAISE EXCEPTION 'REPORTS_ACCESS_DENIED: Solo admin_general puede ejecutar este reporte.';
  END IF;
END;
$$;

-- ── Tipo de retorno del reporte ────────────────────────────────────────────────
DROP TYPE IF EXISTS public.sales_report_row CASCADE;

CREATE TYPE public.sales_report_row AS (
  id                uuid,
  op_code           text,     -- 'OP-000001'
  report_op_seq     bigint,
  ticket_code       text,
  payment_ref       text,     -- operation_number (Yape/Plin/Transferencia)
  amount            numeric,
  type              text,
  payment_method    text,
  payment_status    text,
  created_at        timestamptz,
  week_number       integer,
  school_name       text,
  client_name       text,     -- COALESCE(invoice_client_name, student, teacher)
  seller_name       text,     -- profiles.full_name via created_by
  description       text,
  is_deleted        boolean
);

-- ── get_sales_report ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_report(
  p_school_id       uuid    DEFAULT NULL,
  p_date_from       text    DEFAULT NULL,   -- 'YYYY-MM-DD'
  p_date_to         text    DEFAULT NULL,   -- 'YYYY-MM-DD'
  p_ticket_code     text    DEFAULT NULL,
  p_op_code         text    DEFAULT NULL,   -- OP-XXXXXX filter
  p_payment_ref     text    DEFAULT NULL,   -- operation_number filter
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
  -- Validar acceso
  PERFORM public.fn_assert_admin_general();

  -- Convertir fechas a Lima timezone
  IF p_date_from IS NOT NULL THEN
    v_date_from := (p_date_from || 'T00:00:00')::timestamp AT TIME ZONE 'America/Lima';
  END IF;

  IF p_date_to IS NOT NULL THEN
    v_date_to := (p_date_to || 'T23:59:59')::timestamp AT TIME ZONE 'America/Lima';
  END IF;

  -- Extraer report_op_seq del filtro OP-XXXXXX si se pasa
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
    'OP-' || lpad(t.report_op_seq::text, 6, '0')           AS op_code,
    t.report_op_seq,
    t.ticket_code,
    t.operation_number                                        AS payment_ref,
    t.amount,
    t.type,
    t.payment_method,
    t.payment_status,
    t.created_at,
    public.get_sales_week_number(t.created_at)               AS week_number,
    sc.name                                                   AS school_name,
    -- Client name: comprobante > alumno > profesor > sin datos
    COALESCE(
      NULLIF(trim(t.invoice_client_name), ''),
      NULLIF(trim(st.full_name), ''),
      NULLIF(trim(tp.full_name), ''),
      'Sin datos'
    )                                                         AS client_name,
    -- Seller: quien registró la transacción
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      p.email,
      'Sin datos'
    )                                                         AS seller_name,
    t.description,
    t.is_deleted
  FROM public.transactions t
  LEFT JOIN public.schools          sc ON sc.id = t.school_id
  LEFT JOIN public.students         st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles          p ON  p.id = t.created_by
  WHERE
    -- Soft-delete
    (p_include_deleted OR coalesce(t.is_deleted, false) = false)
    -- Sede (multitenancy: efectivo cuando viene del frontend protegido)
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
    -- Rango de fechas (Lima)
    AND (v_date_from IS NULL OR t.created_at >= v_date_from)
    AND (v_date_to   IS NULL OR t.created_at <= v_date_to)
    -- Ticket
    AND (p_ticket_code IS NULL OR t.ticket_code ILIKE '%' || p_ticket_code || '%')
    -- OP-XXXXXX
    AND (v_op_seq IS NULL OR t.report_op_seq = v_op_seq)
    -- Referencia de pago (Yape/Plin)
    AND (p_payment_ref IS NULL OR t.operation_number ILIKE '%' || p_payment_ref || '%')
    -- Nombre cliente (trigrama vía GIN index)
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name           ILIKE '%' || p_client_name || '%'
      OR tp.full_name           ILIKE '%' || p_client_name || '%'
    )
    -- Nombre vendedor
    AND (
      p_seller_name IS NULL
      OR p.full_name ILIKE '%' || p_seller_name || '%'
      OR p.email     ILIKE '%' || p_seller_name || '%'
    )
    -- Método de pago
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    -- Estado de pago
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
  INTO   v_count
  FROM   public.transactions t
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
    AND (p_payment_ref IS NULL OR t.operation_number ILIKE '%' || p_payment_ref || '%')
    AND (
      p_client_name IS NULL
      OR t.invoice_client_name ILIKE '%' || p_client_name || '%'
      OR st.full_name           ILIKE '%' || p_client_name || '%'
      OR tp.full_name           ILIKE '%' || p_client_name || '%'
    )
    AND (
      p_seller_name IS NULL
      OR p.full_name ILIKE '%' || p_seller_name || '%'
      OR p.email     ILIKE '%' || p_seller_name || '%'
    )
    AND (p_payment_method IS NULL OR t.payment_method = p_payment_method)
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status);

  RETURN coalesce(v_count, 0);
END;
$$;
