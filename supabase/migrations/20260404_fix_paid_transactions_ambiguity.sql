-- ============================================================
-- PARCHE: Error 42702 en get_billing_paid_transactions
-- ============================================================
-- CAUSA:
--   La función usa RETURNS TABLE (..., school_id uuid, ...) lo que
--   crea una variable interna "school_id" en plpgsql.
--   El bloque de seguridad hacía:
--       SELECT role, school_id FROM profiles WHERE id = v_caller_id
--   Postgres no podía distinguir si "school_id" era la columna de
--   profiles o la variable OUT de RETURNS TABLE → error 42702.
--
-- FIX:
--   Cualificar TODAS las referencias de columna en la consulta del
--   perfil con el alias de tabla "p.":
--       SELECT p.role, p.school_id FROM profiles p WHERE p.id = v_caller_id
-- ============================================================


-- ── 1. get_billing_paid_transactions (2 bugs corregidos) ──────────────────
-- Bug 1 (42702): "school_id" ambiguous → alias p. en consulta de perfil
-- Bug 2 (42804): varchar(n) vs text mismatch → ::text en todas las columnas
--               de tipo texto del RETURN QUERY (plpgsql es estricto, sql no)
DROP FUNCTION IF EXISTS get_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,integer,integer);

CREATE OR REPLACE FUNCTION get_billing_paid_transactions(
  p_school_id     uuid        DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_search_term   text        DEFAULT NULL,
  p_offset        integer     DEFAULT 0,
  p_limit         integer     DEFAULT 30
)
RETURNS TABLE (
  id                  uuid,
  type                text,
  amount              numeric,
  payment_status      text,
  payment_method      text,
  operation_number    text,
  description         text,
  created_at          timestamptz,
  school_id           uuid,
  school_name         text,
  student_id          uuid,
  student_full_name   text,
  student_parent_id   uuid,
  teacher_id          uuid,
  teacher_full_name   text,
  manual_client_name  text,
  metadata            jsonb,
  ticket_code         text,
  created_by          uuid,
  paid_with_mixed     boolean,
  cash_amount         numeric,
  card_amount         numeric,
  yape_amount         numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_eff_school_id uuid;
BEGIN

  -- ── BLOQUE DE SEGURIDAD ──────────────────────────────────────────────
  -- FIX 42702: todas las columnas cualificadas con alias "p."
  -- para evitar ambigüedad con las variables OUT de RETURNS TABLE.
  v_caller_id := auth.uid();

  SELECT p.role, p.school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles p
  WHERE  p.id = v_caller_id;

  -- Sin perfil válido → retornar vacío
  IF v_caller_role IS NULL THEN
    RETURN;
  END IF;

  -- admin_general, supervisor_red, superadmin → respetan p_school_id del frontend
  -- Cualquier otro rol → solo puede ver su propia sede
  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- ── Consulta principal ────────────────────────────────────────────────
  -- FIX 42804: ::text explícito en todas las columnas varchar(n)
  -- para que RETURN QUERY coincida con el RETURNS TABLE declarado.
  RETURN QUERY
  SELECT
    t.id,
    t.type::text,
    t.amount,
    t.payment_status::text,
    t.payment_method::text,
    t.operation_number::text,
    t.description::text,
    t.created_at,
    t.school_id,
    s.name::text              AS school_name,
    t.student_id,
    st.full_name::text        AS student_full_name,
    st.parent_id              AS student_parent_id,
    t.teacher_id,
    tp.full_name::text        AS teacher_full_name,
    t.manual_client_name::text,
    t.metadata,
    t.ticket_code::text,
    t.created_by,
    t.paid_with_mixed,
    t.cash_amount,
    t.card_amount,
    t.yape_amount
  FROM transactions t
  LEFT JOIN schools          s  ON s.id  = t.school_id
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status != 'cancelled'
    AND (v_eff_school_id IS NULL OR t.school_id      = v_eff_school_id)
    AND (p_status        IS NULL OR t.payment_status = p_status)
    AND (p_date_from     IS NULL OR t.created_at    >= p_date_from)
    AND (p_date_to       IS NULL OR t.created_at    <= p_date_to)
    AND (
      p_search_term IS NULL
      OR t.description        ILIKE '%' || p_search_term || '%'
      OR t.ticket_code        ILIKE '%' || p_search_term || '%'
      OR t.manual_client_name ILIKE '%' || p_search_term || '%'
      OR st.full_name         ILIKE '%' || p_search_term || '%'
      OR tp.full_name         ILIKE '%' || p_search_term || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION get_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,integer,integer)
  TO authenticated, service_role;


-- ── 2. count_billing_paid_transactions (preventivo, mismo alias) ────────────
-- Esta función retorna bigint (no RETURNS TABLE), así que no tiene el error
-- 42702. Se aplica el mismo patrón de alias para consistencia y prevención.
DROP FUNCTION IF EXISTS count_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text);

CREATE OR REPLACE FUNCTION count_billing_paid_transactions(
  p_school_id     uuid        DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_search_term   text        DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_eff_school_id uuid;
  v_result        bigint;
BEGIN

  -- ── BLOQUE DE SEGURIDAD (con alias p. para consistencia) ─────────────
  v_caller_id := auth.uid();

  SELECT p.role, p.school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles p
  WHERE  p.id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RETURN 0;
  END IF;

  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- ── Conteo principal ──────────────────────────────────────────────────
  SELECT COUNT(*)
  INTO   v_result
  FROM transactions t
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status != 'cancelled'
    AND (v_eff_school_id IS NULL OR t.school_id      = v_eff_school_id)
    AND (p_status        IS NULL OR t.payment_status = p_status)
    AND (p_date_from     IS NULL OR t.created_at    >= p_date_from)
    AND (p_date_to       IS NULL OR t.created_at    <= p_date_to)
    AND (
      p_search_term IS NULL
      OR t.description        ILIKE '%' || p_search_term || '%'
      OR t.ticket_code        ILIKE '%' || p_search_term || '%'
      OR t.manual_client_name ILIKE '%' || p_search_term || '%'
      OR st.full_name         ILIKE '%' || p_search_term || '%'
      OR tp.full_name         ILIKE '%' || p_search_term || '%'
    );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION count_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text)
  TO authenticated, service_role;


-- ── Verificación ─────────────────────────────────────────────────────────────
SELECT
  proname                          AS funcion,
  pronargs                         AS num_params,
  prosecdef                        AS security_definer
FROM pg_proc
WHERE proname IN (
  'get_billing_paid_transactions',
  'count_billing_paid_transactions'
)
ORDER BY proname;
