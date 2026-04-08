-- ============================================================
-- FIX PGRST203: eliminar sobrecarga de get_billing_consolidated_debtors
-- ============================================================
-- PostgREST no soporta function overloading.
-- Existían DOS versiones (6 params y 7 params).
-- Este script las borra a ambas y deja solo la de 7 parámetros.
-- ============================================================

-- Borrar TODAS las variantes posibles (por número de parámetros)
DROP FUNCTION IF EXISTS get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer);
DROP FUNCTION IF EXISTS get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer, timestamptz);

-- Re-crear la versión definitiva (7 params, incluye p_from_date)
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

  v_total_count integer;
  v_debtors     jsonb;
BEGIN

  -- ── Seguridad: solo usuarios autenticados con rol conocido ───
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

  -- Cap: entre 1 y 5000 filas
  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 5000);

  -- ── Consulta principal ───────────────────────────────────────
  WITH

  real_pending AS (
    SELECT
      t.id::text                                              AS id,
      t.amount::numeric                                       AS amount,
      t.description::text                                     AS description,
      t.created_at::timestamptz                               AS created_at,
      t.payment_status::text                                  AS payment_status,
      t.metadata::jsonb                                       AS metadata,
      t.student_id::uuid                                      AS student_id,
      t.teacher_id::uuid                                      AS teacher_id,
      t.manual_client_name::text                              AS manual_client_name,
      t.school_id::uuid                                       AS school_id,
      ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS is_lunch
    FROM transactions t
    WHERE t.type           = 'purchase'
      AND t.is_deleted     = false
      AND t.payment_status IN ('pending', 'partial')
      AND (v_eff_school_id IS NULL OR t.school_id = v_eff_school_id)
      AND (p_from_date  IS NULL OR t.created_at >= p_from_date)
      AND (p_until_date IS NULL OR t.created_at <= p_until_date)
      AND (
        p_transaction_type IS NULL
        OR (p_transaction_type = 'cafeteria' AND (t.metadata->>'lunch_order_id') IS NULL)
        OR (p_transaction_type = 'lunch'     AND (t.metadata->>'lunch_order_id') IS NOT NULL)
      )
  ),

  virtual_lunch AS (
    SELECT
      ('lunch_' || lo.id::text)::text                         AS id,
      (-ABS(ROUND(
        CASE
          WHEN lo.final_price IS NOT NULL AND lo.final_price > 0 THEN lo.final_price
          WHEN lc.price IS NOT NULL AND lc.price > 0             THEN lc.price * COALESCE(lo.quantity, 1)
          WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0 THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
          ELSE 7.50 * COALESCE(lo.quantity, 1)
        END, 2
      )))::numeric                                            AS amount,
      (
        'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
        CASE WHEN COALESCE(lo.quantity, 1) > 1 THEN ' (' || COALESCE(lo.quantity, 1)::text || 'x)' ELSE '' END ||
        ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
      )::text                                                 AS description,
      (lo.order_date::date + interval '17 hours')::timestamptz AS created_at,
      'pending'::text                                         AS payment_status,
      jsonb_build_object(
        'lunch_order_id', lo.id::text,
        'source',         'lunch_order',
        'order_date',     lo.order_date
      )::jsonb                                                AS metadata,
      lo.student_id::uuid                                     AS student_id,
      lo.teacher_id::uuid                                     AS teacher_id,
      lo.manual_name::text                                    AS manual_client_name,
      COALESCE(lo.school_id, st.school_id, tp.school_id_1)::uuid AS school_id,
      true::boolean                                           AS is_lunch
    FROM lunch_orders lo
    LEFT JOIN lunch_categories    lc   ON lc.id  = lo.category_id
    LEFT JOIN students            st   ON st.id  = lo.student_id
    LEFT JOIN teacher_profiles    tp   ON tp.id  = lo.teacher_id
    LEFT JOIN lunch_configuration lcfg
           ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
    WHERE lo.is_cancelled   = false
      AND lo.payment_method = 'pagar_luego'
      AND lo.status NOT IN ('cancelled')
      AND (
        v_eff_school_id IS NULL
        OR lo.school_id    = v_eff_school_id
        OR st.school_id    = v_eff_school_id
        OR tp.school_id_1  = v_eff_school_id
      )
      AND (p_from_date  IS NULL OR lo.order_date >= p_from_date::date)
      AND (p_until_date IS NULL OR (lo.order_date::date + interval '17 hours') <= p_until_date)
      AND (p_transaction_type IS NULL OR p_transaction_type = 'lunch')
      AND NOT EXISTS (
        SELECT 1 FROM transactions t2
        WHERE (t2.metadata->>'lunch_order_id') = lo.id::text
          AND t2.is_deleted = false
          AND t2.payment_status IN ('pending', 'partial', 'paid')
      )
  ),

  all_pending AS (
    SELECT * FROM real_pending
    UNION ALL
    SELECT * FROM virtual_lunch
  ),

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
      SUM(ABS(ap.amount))                                    AS total_amount,
      SUM(ABS(ap.amount)) FILTER (WHERE ap.is_lunch)         AS lunch_amount,
      SUM(ABS(ap.amount)) FILTER (WHERE NOT ap.is_lunch)     AS cafeteria_amount,
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

  enriched AS (
    SELECT
      g.*,
      COALESCE(st.full_name, tp.full_name, g.manual_client_name, 'Sin nombre') AS client_name,
      COALESCE(st.grade,   '') AS student_grade,
      COALESCE(st.section, '') AS student_section,
      st.parent_id,
      COALESCE(pp.full_name, '') AS parent_name,
      COALESCE(pp.phone_1,   '') AS parent_phone,
      COALESCE(s.name, 'Sin sede')  AS school_name
    FROM grouped g
    LEFT JOIN students         st ON st.id      = g.student_id
    LEFT JOIN teacher_profiles tp ON tp.id      = g.teacher_id
    LEFT JOIN parent_profiles  pp ON pp.user_id = st.parent_id
    LEFT JOIN schools           s ON s.id       = g.school_id
    WHERE (
      p_search IS NULL
      OR COALESCE(st.full_name, tp.full_name, g.manual_client_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(pp.full_name, '') ILIKE '%' || p_search || '%'
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
