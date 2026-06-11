-- ============================================================
-- Estandarización de columna "Cliente" — Reporte de Ventas
-- ============================================================
-- Regla de negocio nueva:
--
--   · Venta con cuenta registrada (student_id / teacher_id con
--     nombre disponible):
--       → Nombre completo del titular.  Sin prefijo.
--         Ejemplo: "María García"
--
--   · Venta Sin Crédito (sin student_id ni teacher_id útil):
--       → 'VSC'           si no hay nombre manual ni fiscal.
--         Ejemplo: venta POS genérica en ticket sin datos.
--       → 'VSC [nombre]'  si existe invoice_client_name o
--                          manual_client_name (en ese orden).
--         Ejemplo: "VSC Juan Pérez"
--
-- Prioridad para el nombre dentro de VSC:
--   1. invoice_client_name  (boleta/factura — dato fiscal oficial)
--   2. manual_client_name   (almuerzo físico sin cuenta, cobranzas)
--
-- Ajustes adicionales:
--   · Filtro p_client_name ahora incluye manual_client_name para
--     que buscar "pepito" encuentre filas "VSC pepito".
--   · La búsqueda opera sobre datos crudos (sin prefijo VSC)
--     porque lo proyectado ya es la columna derivada.
--   · count_sales_report mantiene el WHERE IDÉNTICO a
--     get_sales_report para que la paginación nunca se desalinee.
--
-- NO se modifica:
--   · Firma, parámetros ni tipo de retorno de ninguna función.
--   · Tablas, columnas, índices ni secuencias.
--   · Lógica de payment_ref, seller_name, paginación o fuzzy.
--   · Ningún flujo de cobro, saldo, voucher ni pasarela.
-- ============================================================

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

  -- Normalizar búsquedas de texto: insensible a acentos y mayúsculas.
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
    -- ── Referencia de pago unificada ──────────────────────────────────────
    -- NULL cuando el dato no tiene sentido contable (sin pago digital real).
    CASE
      WHEN t.payment_status NOT IN ('paid', 'completed')
        OR t.payment_method  IN ('efectivo', 'cash')
      THEN NULL
      ELSE COALESCE(
        NULLIF(trim(t.operation_number::text),          ''),
        NULLIF(trim(t.metadata->>'operation_number'),   ''),
        NULLIF(trim(t.metadata->>'num_operacion'),      ''),
        NULLIF(trim(t.metadata->>'pago_referencia'),    ''),
        NULLIF(trim(t.metadata->>'nro_operacion'),      ''),
        NULLIF(trim(t.gateway_reference_id::text),      '')
      )
    END::text                                             AS payment_ref,
    t.amount,
    t.type::text,
    t.payment_method::text,
    t.payment_status::text,
    t.created_at,
    public.get_sales_week_number(t.created_at)            AS week_number,
    sc.name::text                                         AS school_name,
    -- ── Columna Cliente: regla VSC ────────────────────────────────────────
    -- Venta con cuenta registrada → nombre del titular (sin prefijo).
    -- Venta Sin Crédito           → 'VSC' o 'VSC [nombre]'.
    --
    -- Prioridad del nombre dentro de VSC:
    --   invoice_client_name  (dato fiscal oficial: boleta/factura)
    --   manual_client_name   (almuerzo físico sin cuenta, cobranzas)
    CASE
      WHEN NULLIF(trim(st.full_name), '') IS NOT NULL
        THEN trim(st.full_name)
      WHEN NULLIF(trim(tp.full_name), '') IS NOT NULL
        THEN trim(tp.full_name)
      ELSE
        CASE
          WHEN NULLIF(trim(COALESCE(
                 NULLIF(trim(t.invoice_client_name), ''),
                 NULLIF(trim(t.manual_client_name),  '')
               )), '') IS NOT NULL
            THEN 'VSC ' || trim(COALESCE(
                   NULLIF(trim(t.invoice_client_name), ''),
                   NULLIF(trim(t.manual_client_name),  '')
                 ))
          ELSE 'VSC'
        END
    END::text                                             AS client_name,
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
    -- ── Filtro de referencia: coherente con la proyección ─────────────────
    AND (
      p_payment_ref IS NULL
      OR (
        t.payment_status IN ('paid', 'completed')
        AND t.payment_method NOT IN ('efectivo', 'cash')
        AND (
             t.operation_number                ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'operation_number'   ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'num_operacion'       ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'pago_referencia'     ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'nro_operacion'       ILIKE '%' || p_payment_ref || '%'
          OR t.gateway_reference_id             ILIKE '%' || p_payment_ref || '%'
        )
      )
    )
    -- ── Filtro de cliente: busca en datos crudos (sin prefijo VSC) ────────
    -- Incluye manual_client_name para que "pepito" encuentre "VSC pepito".
    AND (
      v_client_q IS NULL
      OR public.f_unaccent(lower(COALESCE(st.full_name,             ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(st.full_name,             ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(tp.full_name,             ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(tp.full_name,             ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.invoice_client_name,   ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.invoice_client_name,   ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.manual_client_name,    ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.manual_client_name,    ''))), v_client_q) > 0.3
    )
    -- ── Filtro de vendedor ────────────────────────────────────────────────
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

COMMENT ON FUNCTION public.get_sales_report IS
  'Reporte paginado de ventas. '
  'client_name: nombre completo para cuentas registradas (alumno/profesor); '
  '"VSC" o "VSC [nombre]" para ventas sin crédito. '
  'Orden de nombre VSC: invoice_client_name > manual_client_name. '
  'Filtro p_client_name busca sobre datos crudos (sin prefijo). '
  'payment_ref unifica operation_number, metadata y gateway_reference_id. '
  'Acceso restringido a admin_general (fn_assert_admin_general).';


-- ============================================================
-- count_sales_report — WHERE IDÉNTICO a get_sales_report
-- ============================================================
-- Mantener la paridad exacta garantiza que la paginación nunca
-- devuelva "Pág. 3 de 2". Cualquier cambio en el WHERE de
-- get_sales_report debe replicarse aquí de forma simétrica.
-- ============================================================

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
    AND (
      p_payment_ref IS NULL
      OR (
        t.payment_status IN ('paid', 'completed')
        AND t.payment_method NOT IN ('efectivo', 'cash')
        AND (
             t.operation_number                ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'operation_number'   ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'num_operacion'       ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'pago_referencia'     ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'nro_operacion'       ILIKE '%' || p_payment_ref || '%'
          OR t.gateway_reference_id             ILIKE '%' || p_payment_ref || '%'
        )
      )
    )
    AND (
      v_client_q IS NULL
      OR public.f_unaccent(lower(COALESCE(st.full_name,             ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(st.full_name,             ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(tp.full_name,             ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(tp.full_name,             ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.invoice_client_name,   ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.invoice_client_name,   ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.manual_client_name,    ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.manual_client_name,    ''))), v_client_q) > 0.3
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

COMMENT ON FUNCTION public.count_sales_report IS
  'Conteo para paginación de get_sales_report. '
  'WHERE idéntico al de get_sales_report (incluyendo manual_client_name). '
  'Acceso restringido a admin_general (fn_assert_admin_general).';
