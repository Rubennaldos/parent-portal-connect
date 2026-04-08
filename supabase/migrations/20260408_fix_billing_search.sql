-- ============================================================
-- FIX: get_billing_consolidated_debtors v4
--
-- Problemas resueltos:
--   1. Búsqueda (p_search) fallaba porque las fechas filtraban
--      los datos ANTES de llegar al WHERE con ILIKE.
--      → Cuando hay búsqueda, los filtros de fecha se ignoran.
--
--   2. school_id de la vista viene de la transacción, pero
--      el alumno puede pertenecer a otra sede si hubo un cambio.
--      → El filtro de sede ahora también busca en students.school_id
--        como respaldo.
--
--   3. Búsqueda solo miraba full_name del alumno / padre.
--      → Ahora también busca en: apellidos separados, nombre
--        del manual_client_name y nombre de la sede.
-- ============================================================

DROP FUNCTION IF EXISTS get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer);
DROP FUNCTION IF EXISTS get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer, timestamptz);

CREATE OR REPLACE FUNCTION get_billing_consolidated_debtors(
  p_school_id        uuid        DEFAULT NULL,
  p_until_date       timestamptz DEFAULT NULL,
  p_transaction_type text        DEFAULT NULL,
  p_search           text        DEFAULT NULL,
  p_offset           integer     DEFAULT 0,
  p_limit            integer     DEFAULT 2000,
  p_from_date        timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_eff_school_id uuid;
  v_safe_limit    integer;
  v_total_count   integer;
  v_debtors       jsonb;
  v_is_search     boolean;  -- TRUE cuando hay término de búsqueda
BEGIN

  -- ── Seguridad ────────────────────────────────────────────────────────────
  v_caller_id := auth.uid();

  SELECT p.role, p.school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles p
  WHERE  p.id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('total_count', 0, 'debtors', '[]'::jsonb);
  END IF;

  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 5000);

  -- Cuando hay búsqueda por nombre, ignoramos filtros de fecha:
  -- el admin quiere encontrar al alumno sin importar el período.
  v_is_search := (p_search IS NOT NULL AND trim(p_search) <> '');

  -- ── Consulta principal ───────────────────────────────────────────────────
  WITH

  -- PASO A: filas de la vista sin filtro de fecha si hay búsqueda.
  -- El filtro de sede usa school_id de la vista Y como respaldo el de students.
  all_pending AS (
    SELECT
      vsd.deuda_id                AS id,
      vsd.monto                   AS amount,
      vsd.descripcion             AS description,
      vsd.fecha                   AS created_at,
      'pending'::text             AS payment_status,
      vsd.metadata                AS metadata,
      vsd.student_id              AS student_id,
      vsd.teacher_id              AS teacher_id,
      vsd.manual_client_name      AS manual_client_name,
      vsd.school_id               AS school_id,
      vsd.es_almuerzo             AS is_lunch
    FROM view_student_debts vsd
    -- Respaldo de sede: si la transacción no tiene school_id, mirar el del alumno
    LEFT JOIN students _st ON _st.id = vsd.student_id
    WHERE
      -- ✅ Sin filtro de fuente: incluye transaccion, almuerzo_virtual Y saldo_negativo
      -- Filtro de sede: acepta si coincide en la vista O en el alumno
      (
        v_eff_school_id IS NULL
        OR vsd.school_id = v_eff_school_id
        OR _st.school_id = v_eff_school_id
      )

      -- Filtro de fechas: se omite cuando hay búsqueda por nombre
      -- Para saldo_negativo la fecha es NOW() → siempre dentro del rango "hasta hoy"
      AND (v_is_search OR p_from_date  IS NULL OR vsd.fecha >= p_from_date)
      AND (v_is_search OR p_until_date IS NULL OR vsd.fecha <= p_until_date)

      -- Filtro de tipo: saldo_negativo se trata como cafetería (no es almuerzo)
      AND (
        p_transaction_type IS NULL
        OR (p_transaction_type = 'cafeteria' AND NOT vsd.es_almuerzo)
        OR (p_transaction_type = 'lunch'     AND vsd.es_almuerzo)
      )
  ),

  -- PASO B: agrupar por deudor
  grouped AS (
    SELECT
      COALESCE(
        ap.student_id::text,
        ap.teacher_id::text,
        'manual_' || lower(trim(COALESCE(ap.manual_client_name, ''))),
        'unk_' || ap.school_id::text
      ) AS debtor_key,
      CASE
        WHEN ap.student_id IS NOT NULL THEN 'student'
        WHEN ap.teacher_id IS NOT NULL THEN 'teacher'
        ELSE 'manual'
      END AS client_type,
      ap.student_id,
      ap.teacher_id,
      ap.manual_client_name,
      ap.school_id,
      SUM(ap.amount)                                         AS total_amount,
      SUM(ap.amount) FILTER (WHERE ap.is_lunch)              AS lunch_amount,
      SUM(ap.amount) FILTER (WHERE NOT ap.is_lunch)          AS cafeteria_amount,
      COUNT(*)                                               AS tx_count,
      BOOL_OR(ap.is_lunch)                                   AS has_lunch_debt,
      MAX(ap.created_at)                                     AS latest_tx_at,
      jsonb_agg(
        jsonb_build_object(
          'id',             ap.id,
          'amount',         ap.amount,
          'description',    ap.description,
          'created_at',     ap.created_at,
          'payment_status', ap.payment_status,
          'metadata',       ap.metadata,
          'is_lunch',       ap.is_lunch
        ) ORDER BY ap.created_at DESC
      ) AS transactions
    FROM all_pending ap
    GROUP BY
      COALESCE(ap.student_id::text, ap.teacher_id::text,
               'manual_' || lower(trim(COALESCE(ap.manual_client_name, ''))),
               'unk_' || ap.school_id::text),
      ap.student_id, ap.teacher_id, ap.manual_client_name, ap.school_id,
      CASE WHEN ap.student_id IS NOT NULL THEN 'student'
           WHEN ap.teacher_id IS NOT NULL THEN 'teacher'
           ELSE 'manual' END
  ),

  -- PASO C: enriquecer con nombres y aplicar búsqueda
  enriched AS (
    SELECT
      g.*,
      COALESCE(st.full_name, tp.full_name, g.manual_client_name, 'Sin nombre') AS client_name,
      COALESCE(st.grade,   '') AS student_grade,
      COALESCE(st.section, '') AS student_section,
      st.parent_id,
      COALESCE(pp.full_name, '') AS parent_name,
      COALESCE(pp.phone_1,   '') AS parent_phone,
      COALESCE(s.name, 'Sin sede') AS school_name
    FROM grouped g
    LEFT JOIN students         st ON st.id      = g.student_id
    LEFT JOIN teacher_profiles tp ON tp.id      = g.teacher_id
    LEFT JOIN parent_profiles  pp ON pp.user_id = st.parent_id
    LEFT JOIN schools           s ON s.id       = g.school_id
    WHERE (
      -- Sin búsqueda: mostrar todos
      NOT v_is_search
      -- Con búsqueda: buscar en nombre alumno, padre, nombre manual y sede
      OR COALESCE(st.full_name,         '') ILIKE '%' || p_search || '%'
      OR COALESCE(tp.full_name,         '') ILIKE '%' || p_search || '%'
      OR COALESCE(g.manual_client_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(pp.full_name,         '') ILIKE '%' || p_search || '%'
      OR COALESCE(s.name,               '') ILIKE '%' || p_search || '%'
    )
  ),

  voucher_status AS (
    SELECT
      rr.student_id,
      CASE WHEN bool_or(rr.status = 'pending')  THEN 'pending'
           WHEN bool_or(rr.status = 'rejected') THEN 'rejected'
           ELSE 'none' END AS v_status
    FROM recharge_requests rr
    WHERE rr.request_type IN ('lunch_payment', 'debt_payment')
      AND rr.status IN ('pending', 'rejected')
    GROUP BY rr.student_id
  )

  SELECT
    MAX(sub.total_count)::integer,
    jsonb_agg(sub.row_data ORDER BY sub.row_data->>'latest_tx_at' DESC)
  INTO v_total_count, v_debtors
  FROM (
    SELECT
      jsonb_build_object(
        'id',               e.debtor_key,
        'client_name',      e.client_name,
        'client_type',      e.client_type,
        'student_grade',    e.student_grade,
        'student_section',  e.student_section,
        'parent_id',        e.parent_id,
        'parent_name',      e.parent_name,
        'parent_phone',     e.parent_phone,
        'school_id',        e.school_id,
        'school_name',      e.school_name,
        'total_amount',     ROUND(e.total_amount, 2),
        'lunch_amount',     ROUND(COALESCE(e.lunch_amount,    0), 2),
        'cafeteria_amount', ROUND(COALESCE(e.cafeteria_amount,0), 2),
        'transaction_count',e.tx_count,
        'has_lunch_debt',   e.has_lunch_debt,
        'voucher_status',   COALESCE(vs.v_status, 'none'),
        'latest_tx_at',     e.latest_tx_at,
        'transactions',     e.transactions
      ) AS row_data,
      COUNT(*) OVER () AS total_count
    FROM enriched e
    LEFT JOIN voucher_status vs ON vs.student_id = e.student_id
    ORDER BY e.latest_tx_at DESC NULLS LAST
    LIMIT  v_safe_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'total_count', COALESCE(v_total_count, 0),
    'debtors',     COALESCE(v_debtors, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer, timestamptz)
  TO authenticated, service_role;


-- ============================================================
-- QUERY DE DIAGNÓSTICO — pégala primero en Supabase para
-- confirmar que los datos están en la vista antes del deploy.
-- ============================================================
-- 
-- ① Ver qué hay en la vista (las primeras 20 filas):
-- SELECT deuda_id, student_id, school_id, monto, descripcion, fuente
-- FROM view_student_debts LIMIT 20;
--
-- ② Buscar un alumno específico (cambia el nombre):
-- SELECT vsd.*, s.full_name, s.school_id AS alumno_school_id
-- FROM view_student_debts vsd
-- JOIN students s ON s.id = vsd.student_id
-- WHERE s.full_name ILIKE '%rimarachin%'
--    OR s.full_name ILIKE '%marianela%'
--    OR s.full_name ILIKE '%emma%';
--
-- ③ Verificar que el school_id de la transacción coincide con el alumno:
-- SELECT t.school_id AS tx_school, s.school_id AS alumno_school,
--        s.full_name, t.payment_status, t.amount
-- FROM transactions t
-- JOIN students s ON s.id = t.student_id
-- WHERE t.payment_status IN ('pending','partial')
--   AND t.is_deleted = false
-- LIMIT 20;
-- ============================================================
