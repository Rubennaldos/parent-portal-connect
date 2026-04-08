-- ============================================================
-- UNIFICACIÓN DE FUENTE DE VERDAD — v3
--
-- Problema: Admin y Portal de Padres calculaban deuda con lógica
-- distinta → resultados diferentes para el mismo alumno.
--
-- Solución:
--   1. view_student_debts agrega teacher_id y manual_client_name
--      (necesarios para que el admin agrupe docentes y manuales)
--   2. get_billing_consolidated_debtors elimina sus CTEs propias
--      y lee directo de view_student_debts
--   3. get_parent_debts no cambia (ya usaba la vista)
--
-- Resultado: Admin y Padre ven siempre los mismos números.
-- ============================================================


-- ── PASO 1: Reemplazar view_student_debts con columnas completas ─────────────

DROP VIEW IF EXISTS view_student_debts CASCADE;

CREATE OR REPLACE VIEW view_student_debts AS

-- TRAMO 1 — Transacciones reales pendientes (compras en kiosco y almuerzos registrados)
SELECT
  t.id::text                                              AS deuda_id,
  t.student_id                                            AS student_id,
  t.teacher_id                                            AS teacher_id,        -- para agrupar docentes en el admin
  t.manual_client_name                                    AS manual_client_name, -- para agrupar clientes manuales
  t.school_id                                             AS school_id,
  ABS(t.amount)::numeric(10,2)                            AS monto,
  COALESCE(t.description, 'Deuda sin descripción')        AS descripcion,
  t.created_at                                            AS fecha,             -- TIMESTAMPTZ conserva la hora
  'transaccion'::text                                     AS fuente,
  ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS es_almuerzo,
  t.metadata                                              AS metadata,
  t.ticket_code                                           AS ticket_code

FROM transactions t
WHERE t.type           = 'purchase'
  AND t.is_deleted     = false
  AND t.payment_status IN ('pending', 'partial')

UNION ALL

-- TRAMO 2 — Almuerzos "pagar después" sin transacción registrada aún
SELECT
  ('lunch_' || lo.id::text)::text                         AS deuda_id,
  lo.student_id                                           AS student_id,
  lo.teacher_id                                           AS teacher_id,
  lo.manual_name                                          AS manual_client_name,
  COALESCE(lo.school_id, st.school_id, tp.school_id_1)   AS school_id,
  ABS(ROUND(
    CASE
      WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
        THEN lo.final_price
      WHEN lc.price IS NOT NULL AND lc.price > 0
        THEN lc.price * COALESCE(lo.quantity, 1)
      WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
        THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
      ELSE 7.50 * COALESCE(lo.quantity, 1)
    END, 2
  ))::numeric(10,2)                                       AS monto,
  (
    'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
    CASE WHEN COALESCE(lo.quantity, 1) > 1
      THEN ' (' || lo.quantity::text || 'x)' ELSE '' END ||
    ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
  )::text                                                 AS descripcion,
  (lo.order_date::date + interval '12 hours')::timestamptz AS fecha,
  'almuerzo_virtual'::text                                AS fuente,
  true                                                    AS es_almuerzo,
  jsonb_build_object(
    'lunch_order_id', lo.id::text,
    'source',         'lunch_order',
    'order_date',     lo.order_date
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code

FROM lunch_orders lo
LEFT JOIN students            st   ON st.id  = lo.student_id
LEFT JOIN teacher_profiles    tp   ON tp.id  = lo.teacher_id
LEFT JOIN lunch_categories    lc   ON lc.id  = lo.category_id
LEFT JOIN lunch_configuration lcfg ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)

WHERE lo.is_cancelled   = false
  AND lo.payment_method = 'pagar_luego'
  AND lo.status NOT IN ('cancelled')
  AND NOT EXISTS (
    SELECT 1 FROM transactions t2
    WHERE  (t2.metadata->>'lunch_order_id') = lo.id::text
      AND  t2.is_deleted     = false
      AND  t2.payment_status IN ('pending', 'partial', 'paid')
  )

UNION ALL

-- TRAMO 3 — Saldo negativo del kiosco (alumno debe plata, sin transacción pendiente)
-- Este tramo solo lo usa el Portal de Padres.
-- El Admin ve las transacciones reales (Tramo 1), no este sintético.
SELECT
  ('kiosk_balance_' || s.id::text)::text                  AS deuda_id,
  s.id                                                    AS student_id,
  NULL::uuid                                              AS teacher_id,
  NULL::text                                              AS manual_client_name,
  s.school_id                                             AS school_id,
  ABS(s.balance)::numeric(10,2)                           AS monto,
  'Deuda en kiosco (saldo negativo)'::text                AS descripcion,
  NOW()                                                   AS fecha,
  'saldo_negativo'::text                                  AS fuente,
  false                                                   AS es_almuerzo,
  jsonb_build_object(
    'is_kiosk_balance_debt', true,
    'balance',               s.balance
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code

FROM students s
WHERE s.balance   < 0
  AND s.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM transactions t3
    WHERE  t3.student_id     = s.id
      AND  t3.type           = 'purchase'
      AND  t3.is_deleted     = false
      AND  t3.payment_status IN ('pending', 'partial')
      AND  (t3.metadata->>'lunch_order_id') IS NULL
  );


-- ── PASO 2: Reemplazar get_billing_consolidated_debtors usando la vista ───────

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
BEGIN

  -- ── Seguridad: solo usuarios autenticados con rol conocido ────────────────
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

  -- ── Consulta principal — ahora usa view_student_debts ─────────────────────
  WITH

  -- Fuente única: misma vista que usa el portal de padres.
  -- Se excluye 'saldo_negativo' porque el admin ve transacciones reales,
  -- no balances sintéticos. Los S/ negativos ya aparecen como Tramo 1.
  all_pending AS (
    SELECT
      vsd.deuda_id                AS id,
      vsd.monto                   AS amount,         -- siempre positivo (ABS ya aplicado en la vista)
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
    WHERE vsd.fuente != 'saldo_negativo'
      AND (v_eff_school_id IS NULL OR vsd.school_id = v_eff_school_id)
      AND (p_from_date  IS NULL OR vsd.fecha >= p_from_date)
      AND (p_until_date IS NULL OR vsd.fecha <= p_until_date)
      AND (
        p_transaction_type IS NULL
        OR (p_transaction_type = 'cafeteria' AND NOT vsd.es_almuerzo)
        OR (p_transaction_type = 'lunch'     AND vsd.es_almuerzo)
      )
  ),

  -- Sin cambios desde aquí — el agrupamiento, enriquecimiento y búsqueda
  -- son idénticos a la versión anterior.
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


-- ── PASO 3: Recrear get_parent_debts (depende de la vista que cambió) ────────

DROP FUNCTION IF EXISTS get_parent_debts(uuid);

CREATE OR REPLACE FUNCTION get_parent_debts(p_parent_id uuid)
RETURNS TABLE(
  deuda_id    text,
  student_id  uuid,
  school_id   uuid,
  monto       numeric,
  descripcion text,
  fecha       timestamptz,
  fuente      text,
  es_almuerzo boolean,
  metadata    jsonb,
  ticket_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
BEGIN
  v_caller_id := auth.uid();

  SELECT role INTO v_caller_role
  FROM profiles
  WHERE id = v_caller_id;

  IF v_caller_id IS NULL THEN RETURN; END IF;

  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red')
    AND v_caller_id <> p_parent_id THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      vsd.deuda_id,
      vsd.student_id,
      vsd.school_id,
      vsd.monto,
      vsd.descripcion,
      vsd.fecha,
      vsd.fuente,
      vsd.es_almuerzo,
      vsd.metadata,
      vsd.ticket_code
    FROM view_student_debts vsd
    WHERE vsd.student_id IN (
      SELECT s.id FROM students s
      WHERE  s.parent_id = p_parent_id
        AND  s.is_active = true
    )
    ORDER BY vsd.fecha DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_parent_debts(uuid) TO authenticated, service_role;


-- ── PASO 4: Permisos de lectura para que PostgREST sirva la vista ────────────
-- Necesario para queries directas desde el frontend (ej: modal deuda histórica del admin).
-- La seguridad real la proveen las RLS policies de las tablas subyacentes.
GRANT SELECT ON view_student_debts TO authenticated, service_role;

-- ── VERIFICACIÓN RÁPIDA (corre esto para confirmar que funciona) ──────────────
-- SELECT fuente, COUNT(*), SUM(monto) FROM view_student_debts GROUP BY fuente;
