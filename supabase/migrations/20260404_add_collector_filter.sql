-- ============================================================
-- FILTRO "COBRADO POR USUARIO" en get_billing_paid_transactions
-- y count_billing_paid_transactions
-- ============================================================
-- Cambios:
--   1. Se agrega p_collector_id uuid DEFAULT NULL a ambas funciones.
--   2. En el WHERE: AND (p_collector_id IS NULL OR t.created_by = p_collector_id)
--   3. Se crea get_billing_collectors() — lista de usuarios que tienen
--      al menos una transacción (para el dropdown del frontend).
--
-- NOTA: Se elimina la firma anterior (7 / 5 parámetros) antes de recrear
--       la nueva (8 / 6 parámetros) para evitar conflictos de sobrecarga.
-- ============================================================


-- ── 1. get_billing_paid_transactions — ahora con p_collector_id ────────────

DROP FUNCTION IF EXISTS get_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,integer,integer);
DROP FUNCTION IF EXISTS get_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,uuid,integer,integer);

CREATE OR REPLACE FUNCTION get_billing_paid_transactions(
  p_school_id      uuid        DEFAULT NULL,
  p_status         text        DEFAULT NULL,
  p_date_from      timestamptz DEFAULT NULL,
  p_date_to        timestamptz DEFAULT NULL,
  p_search_term    text        DEFAULT NULL,
  p_collector_id   uuid        DEFAULT NULL,  -- ← NUEVO: filtrar por cajero/admin
  p_offset         integer     DEFAULT 0,
  p_limit          integer     DEFAULT 30
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

  -- ── BLOQUE DE SEGURIDAD ──────────────────────────────────────────────────
  -- Alias "p." en profiles para evitar ambigüedad con OUT vars (fix 42702).
  v_caller_id := auth.uid();

  SELECT p.role, p.school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles p
  WHERE  p.id = v_caller_id;

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

  -- ── Consulta principal ────────────────────────────────────────────────────
  -- ::text explícito en todas las columnas varchar(n) (fix 42804).
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
    AND (v_eff_school_id  IS NULL OR t.school_id      = v_eff_school_id)
    AND (p_status         IS NULL OR t.payment_status = p_status)
    AND (p_date_from      IS NULL OR t.created_at    >= p_date_from)
    AND (p_date_to        IS NULL OR t.created_at    <= p_date_to)
    AND (p_collector_id   IS NULL OR t.created_by    = p_collector_id)   -- ← NUEVO
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

GRANT EXECUTE ON FUNCTION get_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,uuid,integer,integer)
  TO authenticated, service_role;


-- ── 2. count_billing_paid_transactions — ahora con p_collector_id ──────────

DROP FUNCTION IF EXISTS count_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text);
DROP FUNCTION IF EXISTS count_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,uuid);

CREATE OR REPLACE FUNCTION count_billing_paid_transactions(
  p_school_id      uuid        DEFAULT NULL,
  p_status         text        DEFAULT NULL,
  p_date_from      timestamptz DEFAULT NULL,
  p_date_to        timestamptz DEFAULT NULL,
  p_search_term    text        DEFAULT NULL,
  p_collector_id   uuid        DEFAULT NULL   -- ← NUEVO
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

  -- ── BLOQUE DE SEGURIDAD ──────────────────────────────────────────────────
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

  -- ── Conteo principal ──────────────────────────────────────────────────────
  SELECT COUNT(*)
  INTO   v_result
  FROM transactions t
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status != 'cancelled'
    AND (v_eff_school_id  IS NULL OR t.school_id      = v_eff_school_id)
    AND (p_status         IS NULL OR t.payment_status = p_status)
    AND (p_date_from      IS NULL OR t.created_at    >= p_date_from)
    AND (p_date_to        IS NULL OR t.created_at    <= p_date_to)
    AND (p_collector_id   IS NULL OR t.created_by    = p_collector_id)   -- ← NUEVO
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

GRANT EXECUTE ON FUNCTION count_billing_paid_transactions(uuid,text,timestamptz,timestamptz,text,uuid)
  TO authenticated, service_role;


-- ── 3. get_billing_collectors — dropdown de "Cobrado por" ──────────────────
-- Devuelve solo los usuarios que tienen al menos una transacción de tipo
-- 'purchase' registrada, para que el dropdown sea compacto y útil.
-- Respeta el mismo filtro de seguridad por sede que las otras funciones.

DROP FUNCTION IF EXISTS get_billing_collectors(uuid);

CREATE OR REPLACE FUNCTION get_billing_collectors(
  p_school_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id        uuid,
  full_name text,
  role      text
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

  -- ── BLOQUE DE SEGURIDAD ──────────────────────────────────────────────────
  v_caller_id := auth.uid();

  SELECT p.role, p.school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles p
  WHERE  p.id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RETURN;
  END IF;

  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- ── Lista de usuarios con al menos una transacción ────────────────────────
  -- DISTINCT evita duplicados en caso de múltiples transacciones por usuario.
  RETURN QUERY
  SELECT DISTINCT
    pr.id,
    pr.full_name::text,
    pr.role::text
  FROM   profiles pr
  INNER JOIN transactions t ON t.created_by = pr.id
  WHERE  t.type        = 'purchase'
    AND  t.is_deleted  = false
    AND  t.created_by  IS NOT NULL
    AND  (v_eff_school_id IS NULL OR t.school_id = v_eff_school_id)
  ORDER BY pr.full_name::text;
END;
$$;

GRANT EXECUTE ON FUNCTION get_billing_collectors(uuid)
  TO authenticated, service_role;


-- ── Verificación ─────────────────────────────────────────────────────────────
SELECT
  proname    AS funcion,
  pronargs   AS num_params,
  prosecdef  AS security_definer
FROM pg_proc
WHERE proname IN (
  'get_billing_paid_transactions',
  'count_billing_paid_transactions',
  'get_billing_collectors'
)
ORDER BY proname;
