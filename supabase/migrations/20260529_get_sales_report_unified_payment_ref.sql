-- ============================================================
-- Unificación de referencia de pago en Reporte de Ventas
-- ============================================================
-- Problema: get_sales_report proyectaba payment_ref solo desde
-- transactions.operation_number, dejando vacía la columna para:
--   · Ventas POS físicas (el cajero graba en metadata.operation_number)
--   · Pagos web Izipay (se graba en gateway_reference_id)
-- Además, el filtro WHERE y count_sales_report no eran consistentes
-- entre sí ni con la proyección del SELECT.
--
-- Solución:
--   1. COALESCE maestro en SELECT: lee de todas las fuentes conocidas
--      en el orden correcto, y devuelve NULL cuando el dato no tiene
--      sentido contable (efectivo/cash o estado != paid/completed).
--   2. Mismo predicado en el WHERE del filtro p_payment_ref: solo
--      busca en filas donde el dato sería visible, garantizando que
--      "lo que ves es lo que puedes filtrar".
--   3. count_sales_report replica la misma condición para que la
--      paginación nunca se desalinee con los resultados.
--
-- Columnas fuente (orden de prioridad):
--   1. transactions.operation_number       → cobranzas, almuerzo físico
--   2. metadata->>'operation_number'       → POS físico actual
--   3. metadata->>'num_operacion'          → legacy
--   4. metadata->>'pago_referencia'        → legacy
--   5. metadata->>'nro_operacion'          → legacy
--   6. transactions.gateway_reference_id  → pasarela Izipay (GW-)
--
-- Regla de negocio:
--   Retorna NULL cuando payment_status NOT IN ('paid','completed')
--   OR payment_method IN ('efectivo','cash').
--
-- No se tocan: parámetros, paginación, fuzzy search, índices, extensiones.
-- No se modifica ninguna tabla ni columna de la base de datos.
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
    -- De lo contrario, busca en todas las fuentes conocidas en orden de
    -- confiabilidad: columna nativa > metadata POS > metadata legacy > pasarela.
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
    -- ── Filtro de referencia: coherente con la proyección ─────────────────
    -- Solo aplica sobre filas con estado pagado y método digital, que son
    -- exactamente las filas donde payment_ref no sería NULL en el SELECT.
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
    -- ── Filtros de cliente: fuzzy insensible a acentos/caps ───────────────
    AND (
      v_client_q IS NULL
      OR public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(st.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(st.full_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(tp.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(tp.full_name, ''))), v_client_q) > 0.3
    )
    -- ── Filtro de vendedor: idem ──────────────────────────────────────────
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
  'Reporte paginado de ventas con referencia de pago unificada. '
  'payment_ref agrega operation_number, metadata y gateway_reference_id. '
  'Devuelve NULL para efectivo/cash o estados no pagados. '
  'El filtro p_payment_ref es coherente con la proyección. '
  'Acceso restringido a admin_general (fn_assert_admin_general).';


-- ============================================================
-- count_sales_report — replica exacta del WHERE de get_sales_report
-- ============================================================
-- La paginación requiere que count y rows usen el mismo predicado.
-- Cualquier divergencia entre ambas funciones produce páginas
-- inconsistentes (ej. "Pág. 3 de 2").
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

COMMENT ON FUNCTION public.count_sales_report IS
  'Conteo para paginación de get_sales_report. '
  'WHERE idéntico al de get_sales_report: misma lógica para p_payment_ref. '
  'Acceso restringido a admin_general (fn_assert_admin_general).';
