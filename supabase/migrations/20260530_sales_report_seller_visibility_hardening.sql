-- ============================================================================
-- Hardening forense de vendedor visible en reportes de ventas
-- Fecha: 2026-05-30
-- Alcance:
--   1) Backfill controlado de profiles.full_name vacío desde email local-part.
--   2) seller_name en reportes: full_name -> email -> 'Sistema'.
--   3) Simetría estricta entre get_sales_report y count_sales_report.
-- Riesgo financiero:
--   Ninguno (no toca saldos, cobros, pasarela ni contabilidad).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) Backup determinístico y reversible (se refresca en cada ejecución)
--    Scope: solo perfiles que realmente participan como created_by en ventas.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_profiles_full_name_20260530 (
  id         uuid PRIMARY KEY,
  email      text,
  full_name  text,
  updated_at timestamptz,
  backup_at  timestamptz NOT NULL
);

TRUNCATE TABLE public._backup_profiles_full_name_20260530;

INSERT INTO public._backup_profiles_full_name_20260530 (
  id, email, full_name, updated_at, backup_at
)
SELECT
  p.id,
  p.email,
  p.full_name,
  p.updated_at,
  clock_timestamp()
FROM public.profiles p
WHERE COALESCE(trim(p.full_name), '') = ''
  AND COALESCE(trim(p.email), '') <> ''
  AND COALESCE(trim(split_part(trim(p.email), '@', 1)), '') <> ''
  AND EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.created_by = p.id
  );

-- ----------------------------------------------------------------------------
-- 1) Backfill de full_name (acotado y auditable)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_updated_rows integer := 0;
BEGIN
  UPDATE public.profiles p
  SET
    full_name  = trim(split_part(trim(p.email), '@', 1)),
    updated_at = clock_timestamp()
  WHERE COALESCE(trim(p.full_name), '') = ''
    AND COALESCE(trim(p.email), '') <> ''
    AND COALESCE(trim(split_part(trim(p.email), '@', 1)), '') <> ''
    AND EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.created_by = p.id
    );

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  RAISE NOTICE 'Backfill profiles.full_name aplicado: % filas', v_updated_rows;
END
$$;

-- ----------------------------------------------------------------------------
-- 2) get_sales_report: vendedor visible robusto y filtro simétrico
-- ----------------------------------------------------------------------------
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
  v_date_from   timestamptz;
  v_date_to     timestamptz;
  v_op_seq      bigint;
  v_client_q    text;
  v_seller_q    text;
  v_pm_filter   text;
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

  v_client_q := CASE
    WHEN p_client_name IS NOT NULL AND p_client_name <> ''
      THEN public.f_unaccent(lower(p_client_name))
    ELSE NULL
  END;

  v_seller_q := CASE
    WHEN p_seller_name IS NOT NULL AND p_seller_name <> ''
      THEN public.f_unaccent(lower(p_seller_name))
    ELSE NULL
  END;

  v_pm_filter := NULLIF(lower(trim(p_payment_method)), '');

  RETURN QUERY
  SELECT
    t.id,
    ('OP-' || lpad(t.report_op_seq::text, 6, '0'))::text AS op_code,
    t.report_op_seq,
    t.ticket_code::text,
    CASE
      WHEN t.payment_status NOT IN ('paid', 'completed')
        OR t.payment_method IN ('efectivo', 'cash')
      THEN NULL
      ELSE COALESCE(
        NULLIF(trim(t.operation_number::text), ''),
        NULLIF(trim(t.metadata->>'operation_number'), ''),
        NULLIF(trim(t.metadata->>'num_operacion'), ''),
        NULLIF(trim(t.metadata->>'pago_referencia'), ''),
        NULLIF(trim(t.metadata->>'nro_operacion'), ''),
        NULLIF(trim(t.gateway_reference_id::text), '')
      )
    END::text AS payment_ref,
    t.amount,
    t.type::text,
    pm.payment_method_canon::text AS payment_method,
    t.payment_status::text,
    t.created_at,
    public.get_sales_week_number(t.created_at) AS week_number,
    sc.name::text AS school_name,
    CASE
      WHEN NULLIF(trim(st.full_name), '') IS NOT NULL THEN trim(st.full_name)
      WHEN NULLIF(trim(tp.full_name), '') IS NOT NULL THEN trim(tp.full_name)
      ELSE
        CASE
          WHEN NULLIF(trim(COALESCE(
                 NULLIF(trim(t.invoice_client_name), ''),
                 NULLIF(trim(t.manual_client_name), '')
               )), '') IS NOT NULL
            THEN 'VSC ' || trim(COALESCE(
                   NULLIF(trim(t.invoice_client_name), ''),
                   NULLIF(trim(t.manual_client_name), '')
                 ))
          ELSE 'VSC'
        END
    END::text AS client_name,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(p.email), ''),
      'Sistema'
    )::text AS seller_name,
    t.description::text,
    t.is_deleted
  FROM public.transactions t
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN lower(COALESCE(t.payment_method, '')) IN ('tarjeta', 'card', 'visa', 'mastercard', 'debit', 'card_visa', 'card_mastercard')
        THEN
          CASE
            WHEN lower(COALESCE(t.payment_method, '')) IN ('card', 'card_visa', 'card_mastercard')
                 OR lower(COALESCE(t.metadata->>'source_channel', '')) IN ('parent_web', 'online_payment')
                 OR lower(COALESCE(t.metadata->>'source', '')) IN ('gateway_webhook', 'parent_portal', 'parent_web', 'izipay_webhook')
                 OR (
                   lower(COALESCE(t.type, '')) = 'recharge'
                   AND lower(COALESCE(t.payment_method, '')) IN ('tarjeta', 'card', 'visa', 'mastercard', 'debit', 'card_visa', 'card_mastercard')
                 )
                 OR (
                   t.gateway_reference_id IS NOT NULL
                   AND lower(COALESCE(t.payment_method, '')) IN ('card', 'card_visa', 'card_mastercard')
                 )
              THEN 'Tarjeta online'
            ELSE 'Tarjeta P.O.S'
          END
        ELSE t.payment_method
      END AS payment_method_canon
  ) pm ON true
  LEFT JOIN public.schools sc ON sc.id = t.school_id
  LEFT JOIN public.students st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles p ON p.id = t.created_by
  WHERE
    (p_include_deleted OR coalesce(t.is_deleted, false) = false)
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
    AND (v_date_from IS NULL OR t.created_at >= v_date_from)
    AND (v_date_to IS NULL OR t.created_at <= v_date_to)
    AND (p_ticket_code IS NULL OR t.ticket_code ILIKE '%' || p_ticket_code || '%')
    AND (v_op_seq IS NULL OR t.report_op_seq = v_op_seq)
    AND (
      p_payment_ref IS NULL
      OR (
        t.payment_status IN ('paid', 'completed')
        AND t.payment_method NOT IN ('efectivo', 'cash')
        AND (
             t.operation_number              ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'operation_number' ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'num_operacion'    ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'pago_referencia'  ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'nro_operacion'    ILIKE '%' || p_payment_ref || '%'
          OR t.gateway_reference_id          ILIKE '%' || p_payment_ref || '%'
        )
      )
    )
    AND (
      v_client_q IS NULL
      OR public.f_unaccent(lower(COALESCE(st.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(st.full_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(tp.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(tp.full_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.manual_client_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.manual_client_name, ''))), v_client_q) > 0.3
    )
    AND (
      v_seller_q IS NULL
      OR public.f_unaccent(lower(COALESCE(
           NULLIF(trim(p.full_name), ''),
           NULLIF(trim(p.email), ''),
           ''
         ))) LIKE '%' || v_seller_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(
           NULLIF(trim(p.full_name), ''),
           NULLIF(trim(p.email), ''),
           ''
         ))), v_seller_q) > 0.3
    )
    AND (
      v_pm_filter IS NULL
      OR (
        v_pm_filter = 'tarjeta'
        AND lower(COALESCE(t.payment_method, '')) IN ('tarjeta', 'card', 'visa', 'mastercard', 'debit', 'card_visa', 'card_mastercard')
      )
      OR (
        v_pm_filter IN ('tarjeta p.o.s', 'tarjeta pos', 'tarjeta_pos')
        AND pm.payment_method_canon = 'Tarjeta P.O.S'
      )
      OR (
        v_pm_filter IN ('tarjeta online', 'tarjeta_online')
        AND pm.payment_method_canon = 'Tarjeta online'
      )
      OR lower(COALESCE(t.payment_method, '')) = v_pm_filter
      OR lower(COALESCE(pm.payment_method_canon, '')) = v_pm_filter
    )
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status)
  ORDER BY t.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_sales_report IS
  'Reporte paginado de ventas. '
  'DB-first: separa tarjeta en Tarjeta P.O.S vs Tarjeta online (payment_method canónico), '
  'seller_name robusto (full_name -> email -> Sistema), '
  'mantiene reglas VSC + payment_ref unificado + filtros compatibles (tarjeta/card/canónicos). '
  'Acceso restringido a admin_general (fn_assert_admin_general).';

-- ----------------------------------------------------------------------------
-- 3) count_sales_report: espejo exacto del filtro seller en get_sales_report
-- ----------------------------------------------------------------------------
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
  v_date_from   timestamptz;
  v_date_to     timestamptz;
  v_op_seq      bigint;
  v_client_q    text;
  v_seller_q    text;
  v_pm_filter   text;
  v_count       bigint;
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

  v_client_q := CASE
    WHEN p_client_name IS NOT NULL AND p_client_name <> ''
      THEN public.f_unaccent(lower(p_client_name))
    ELSE NULL
  END;

  v_seller_q := CASE
    WHEN p_seller_name IS NOT NULL AND p_seller_name <> ''
      THEN public.f_unaccent(lower(p_seller_name))
    ELSE NULL
  END;

  v_pm_filter := NULLIF(lower(trim(p_payment_method)), '');

  SELECT count(*) INTO v_count
  FROM public.transactions t
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN lower(COALESCE(t.payment_method, '')) IN ('tarjeta', 'card', 'visa', 'mastercard', 'debit', 'card_visa', 'card_mastercard')
        THEN
          CASE
            WHEN lower(COALESCE(t.payment_method, '')) IN ('card', 'card_visa', 'card_mastercard')
                 OR lower(COALESCE(t.metadata->>'source_channel', '')) IN ('parent_web', 'online_payment')
                 OR lower(COALESCE(t.metadata->>'source', '')) IN ('gateway_webhook', 'parent_portal', 'parent_web', 'izipay_webhook')
                 OR (
                   lower(COALESCE(t.type, '')) = 'recharge'
                   AND lower(COALESCE(t.payment_method, '')) IN ('tarjeta', 'card', 'visa', 'mastercard', 'debit', 'card_visa', 'card_mastercard')
                 )
                 OR (
                   t.gateway_reference_id IS NOT NULL
                   AND lower(COALESCE(t.payment_method, '')) IN ('card', 'card_visa', 'card_mastercard')
                 )
              THEN 'Tarjeta online'
            ELSE 'Tarjeta P.O.S'
          END
        ELSE t.payment_method
      END AS payment_method_canon
  ) pm ON true
  LEFT JOIN public.students st ON st.id = t.student_id
  LEFT JOIN public.teacher_profiles tp ON tp.id = t.teacher_id
  LEFT JOIN public.profiles p ON p.id = t.created_by
  WHERE
    (p_include_deleted OR coalesce(t.is_deleted, false) = false)
    AND (p_school_id IS NULL OR t.school_id = p_school_id)
    AND (v_date_from IS NULL OR t.created_at >= v_date_from)
    AND (v_date_to IS NULL OR t.created_at <= v_date_to)
    AND (p_ticket_code IS NULL OR t.ticket_code ILIKE '%' || p_ticket_code || '%')
    AND (v_op_seq IS NULL OR t.report_op_seq = v_op_seq)
    AND (
      p_payment_ref IS NULL
      OR (
        t.payment_status IN ('paid', 'completed')
        AND t.payment_method NOT IN ('efectivo', 'cash')
        AND (
             t.operation_number              ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'operation_number' ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'num_operacion'    ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'pago_referencia'  ILIKE '%' || p_payment_ref || '%'
          OR t.metadata->>'nro_operacion'    ILIKE '%' || p_payment_ref || '%'
          OR t.gateway_reference_id          ILIKE '%' || p_payment_ref || '%'
        )
      )
    )
    AND (
      v_client_q IS NULL
      OR public.f_unaccent(lower(COALESCE(st.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(st.full_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(tp.full_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(tp.full_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.invoice_client_name, ''))), v_client_q) > 0.3
      OR public.f_unaccent(lower(COALESCE(t.manual_client_name, ''))) LIKE '%' || v_client_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(t.manual_client_name, ''))), v_client_q) > 0.3
    )
    AND (
      v_seller_q IS NULL
      OR public.f_unaccent(lower(COALESCE(
           NULLIF(trim(p.full_name), ''),
           NULLIF(trim(p.email), ''),
           ''
         ))) LIKE '%' || v_seller_q || '%'
      OR similarity(public.f_unaccent(lower(COALESCE(
           NULLIF(trim(p.full_name), ''),
           NULLIF(trim(p.email), ''),
           ''
         ))), v_seller_q) > 0.3
    )
    AND (
      v_pm_filter IS NULL
      OR (
        v_pm_filter = 'tarjeta'
        AND lower(COALESCE(t.payment_method, '')) IN ('tarjeta', 'card', 'visa', 'mastercard', 'debit', 'card_visa', 'card_mastercard')
      )
      OR (
        v_pm_filter IN ('tarjeta p.o.s', 'tarjeta pos', 'tarjeta_pos')
        AND pm.payment_method_canon = 'Tarjeta P.O.S'
      )
      OR (
        v_pm_filter IN ('tarjeta online', 'tarjeta_online')
        AND pm.payment_method_canon = 'Tarjeta online'
      )
      OR lower(COALESCE(t.payment_method, '')) = v_pm_filter
      OR lower(COALESCE(pm.payment_method_canon, '')) = v_pm_filter
    )
    AND (p_payment_status IS NULL OR t.payment_status = p_payment_status);

  RETURN coalesce(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.count_sales_report IS
  'Conteo para paginación de get_sales_report. WHERE simétrico y compatible con '
  'payment_method canónico (Tarjeta P.O.S / Tarjeta online), '
  'seller_name robusto (full_name -> email -> Sistema) y valores históricos.';

COMMIT;
