-- ============================================================
-- BLINDAJE DE SEGURIDAD — RPCs de Cobranzas (v1 — 04-Apr-2026)
-- ============================================================
-- PROBLEMA PREVIO:
--   Los RPCs son SECURITY DEFINER y aceptan p_school_id del cliente.
--   Un usuario autenticado podía manipular ese parámetro desde la
--   consola de Supabase y leer datos de otras sedes.
--
-- SOLUCIÓN APLICADA EN CADA FUNCIÓN:
--   1. Se obtiene auth.uid() al inicio.
--   2. Se consulta role + school_id real del perfil en profiles.
--   3. Roles con acceso total (admin_general, supervisor_red, superadmin):
--      se respeta el p_school_id enviado por el frontend (NULL = todas).
--   4. Cualquier otro rol: se IGNORA el p_school_id del frontend y se
--      sobreescribe con el school_id del perfil (solo su sede).
--   5. Sin perfil válido: la función retorna vacío (seguridad por defecto).
--
-- FUNCIONES AFECTADAS:
--   - get_billing_dashboard_stats
--   - get_billing_consolidated_debtors
--   - get_billing_paid_transactions    (convertida de sql → plpgsql)
--   - count_billing_paid_transactions  (convertida de sql → plpgsql)
-- ============================================================


-- ============================================================
-- 1. get_billing_dashboard_stats  (v3 — blindaje de seguridad)
-- ============================================================
DROP FUNCTION IF EXISTS get_billing_dashboard_stats(uuid, date, date);

CREATE OR REPLACE FUNCTION get_billing_dashboard_stats(
  p_school_id uuid DEFAULT NULL,
  p_date_from date DEFAULT CURRENT_DATE,
  p_date_to   date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── VALIDACIÓN DE SEGURIDAD ──────────────────────────────
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_eff_school_id uuid;   -- school_id efectivo (validado internamente)

  -- Límites para COBROS DEL PERÍODO (ambas fechas aplican)
  v_period_start  timestamptz;
  v_period_end    timestamptz;

  -- Límite superior para DEUDA PENDIENTE (solo p_date_to — no excluir historial)
  v_debt_end      timestamptz;

  v_today         date;
  v_yesterday     date;

  -- ── DEUDA PENDIENTE (transacciones reales) ──────────────────
  v_total_pending         numeric := 0;
  v_lunch_pending         numeric := 0;
  v_cafeteria_pending     numeric := 0;
  v_total_debtors         integer := 0;
  v_lunch_debtors         integer := 0;
  v_cafeteria_debtors     integer := 0;
  v_teacher_debtors       integer := 0;
  v_student_debtors       integer := 0;
  v_manual_debtors        integer := 0;
  v_total_teacher_debt    numeric := 0;
  v_total_student_debt    numeric := 0;
  v_total_manual_debt     numeric := 0;
  v_total_tickets_pending integer := 0;

  -- ── ALMUERZOS VIRTUALES (lunch_orders sin tx) — variables separadas ──
  v_virtual_lunch_pending numeric := 0;
  v_virtual_lunch_debtors integer := 0;

  -- ── COBROS DEL PERÍODO ──────────────────────────────────────
  v_collected_today     numeric := 0;
  v_collected_yesterday numeric := 0;
  v_collected_period    numeric := 0;
  v_tickets_paid        integer := 0;

  -- ── ANTIGÜEDAD DE DEUDA ─────────────────────────────────────
  v_debt_today      numeric := 0; v_count_today      integer := 0;
  v_debt_1to3       numeric := 0; v_count_1to3       integer := 0;
  v_debt_4to7       numeric := 0; v_count_4to7       integer := 0;
  v_debt_8to15      numeric := 0; v_count_8to15      integer := 0;
  v_debt_over15     numeric := 0; v_count_over15     integer := 0;

  -- ── MÉTODOS DE PAGO ─────────────────────────────────────────
  v_pay_efectivo       numeric := 0;
  v_pay_tarjeta        numeric := 0;
  v_pay_yape           numeric := 0;
  v_pay_transferencia  numeric := 0;
  v_pay_plin           numeric := 0;
  v_pay_otro           numeric := 0;

  -- ── REEMBOLSOS PENDIENTES ────────────────────────────────────
  v_refund_count   integer := 0;
  v_refund_amount  numeric := 0;

  -- ── RESULTADOS JSON ─────────────────────────────────────────
  v_top_debtors     jsonb;
  v_by_school       jsonb;
  v_pay_methods_obj jsonb;
  v_debt_age_obj    jsonb;
BEGIN

  -- ============================================================
  -- BLOQUE DE SEGURIDAD: verificar identidad y rol del llamador
  -- ============================================================
  v_caller_id := auth.uid();

  SELECT role, school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles
  WHERE  id = v_caller_id;

  -- Sin perfil válido → retornar objeto vacío por defecto
  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'totalPending', 0, 'lunchPending', 0, 'cafeteriaPending', 0,
      'totalCollectedToday', 0, 'totalCollectedWeek', 0, 'totalCollectedMonth', 0,
      'collectedYesterday', 0, 'totalDebtors', 0, 'totalTicketsPending', 0,
      'totalTicketsPaid', 0, 'lunchDebtors', 0, 'cafeteriaDebtors', 0,
      'totalTeacherDebt', 0, 'totalStudentDebt', 0, 'totalManualDebt', 0,
      'teacherDebtors', 0, 'studentDebtors', 0, 'manualDebtors', 0,
      'debtByAge', '{}', 'paymentMethods', '{}',
      'topDebtors', '[]', 'pendingRefunds', 0, 'pendingRefundAmount', 0,
      'collectionBySchool', '[]'
    );
  END IF;

  -- Roles con acceso total: respetan el p_school_id del frontend
  -- Cualquier otro rol: solo puede ver su propia sede
  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- ── Calcular límites de fecha ahora que tenemos v_eff_school_id ──
  v_period_start := (p_date_from::text || 'T00:00:00-05:00')::timestamptz;
  v_period_end   := (p_date_to::text   || 'T23:59:59-05:00')::timestamptz;
  v_debt_end     := (p_date_to::text   || 'T23:59:59-05:00')::timestamptz;
  v_today        := CURRENT_DATE AT TIME ZONE 'America/Lima';
  v_yesterday    := v_today - interval '1 day';

  -- ============================================================
  -- 1. DEUDA PENDIENTE — transacciones reales
  -- ============================================================
  SELECT
    COALESCE(SUM(ABS(t.amount)), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NOT NULL), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NULL), 0),
    COUNT(DISTINCT COALESCE(t.student_id::text, t.teacher_id::text, lower(trim(t.manual_client_name)), 'unk_' || t.id::text)),
    COUNT(DISTINCT COALESCE(t.student_id::text, t.teacher_id::text, lower(trim(t.manual_client_name)))) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NOT NULL),
    COUNT(DISTINCT COALESCE(t.student_id::text, t.teacher_id::text, lower(trim(t.manual_client_name)))) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NULL),
    COUNT(DISTINCT t.teacher_id) FILTER (WHERE t.teacher_id IS NOT NULL),
    COUNT(DISTINCT t.student_id) FILTER (WHERE t.student_id IS NOT NULL),
    COUNT(DISTINCT lower(trim(t.manual_client_name))) FILTER (WHERE t.manual_client_name IS NOT NULL AND t.student_id IS NULL AND t.teacher_id IS NULL),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.teacher_id IS NOT NULL), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.student_id IS NOT NULL), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.manual_client_name IS NOT NULL AND t.student_id IS NULL AND t.teacher_id IS NULL), 0),
    COUNT(*)
  INTO
    v_total_pending, v_lunch_pending, v_cafeteria_pending,
    v_total_debtors, v_lunch_debtors, v_cafeteria_debtors,
    v_teacher_debtors, v_student_debtors, v_manual_debtors,
    v_total_teacher_debt, v_total_student_debt, v_total_manual_debt,
    v_total_tickets_pending
  FROM transactions t
  WHERE t.type = 'purchase'
    AND t.is_deleted = false
    AND t.payment_status IN ('pending', 'partial')
    AND t.created_at <= v_debt_end
    AND (v_eff_school_id IS NULL OR t.school_id = v_eff_school_id);

  -- ============================================================
  -- 2. ALMUERZOS VIRTUALES — lunch_orders sin transacción real
  -- ============================================================
  SELECT
    COALESCE(SUM(
      CASE
        WHEN lo.final_price > 0 THEN lo.final_price
        WHEN lc.price IS NOT NULL AND lc.price > 0 THEN lc.price * COALESCE(lo.quantity, 1)
        WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0 THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
        ELSE 7.50 * COALESCE(lo.quantity, 1)
      END
    ), 0),
    COUNT(DISTINCT COALESCE(lo.student_id::text, lo.teacher_id::text, lower(trim(lo.manual_name)), 'unk'))
  INTO v_virtual_lunch_pending, v_virtual_lunch_debtors
  FROM lunch_orders lo
  LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
  LEFT JOIN students st ON st.id = lo.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = lo.teacher_id
  LEFT JOIN lunch_configuration lcfg
         ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
  WHERE lo.is_cancelled = false
    AND lo.payment_method = 'pagar_luego'
    AND lo.status NOT IN ('cancelled')
    AND lo.order_date <= p_date_to
    AND (
      v_eff_school_id IS NULL
      OR lo.school_id = v_eff_school_id
      OR st.school_id = v_eff_school_id
      OR tp.school_id_1 = v_eff_school_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM transactions t2
      WHERE (t2.metadata->>'lunch_order_id') = lo.id::text
        AND t2.is_deleted = false
        AND t2.payment_status IN ('pending', 'partial', 'paid')
    );

  v_lunch_pending   := v_lunch_pending + v_virtual_lunch_pending;
  v_lunch_debtors   := v_lunch_debtors + v_virtual_lunch_debtors;
  v_total_pending   := v_total_pending + v_virtual_lunch_pending;
  v_total_debtors   := v_total_debtors + v_virtual_lunch_debtors;

  -- ============================================================
  -- 3. COBROS DEL PERÍODO
  -- ============================================================
  SELECT
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE (t.created_at AT TIME ZONE 'America/Lima')::date = v_today AND (t.metadata->>'source') IS DISTINCT FROM 'pos'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE (t.created_at AT TIME ZONE 'America/Lima')::date = v_yesterday AND (t.metadata->>'source') IS DISTINCT FROM 'pos'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE (t.metadata->>'source') IS DISTINCT FROM 'pos'), 0),
    COUNT(*) FILTER (WHERE (t.metadata->>'source') IS DISTINCT FROM 'pos'),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE lower(t.payment_method) LIKE '%efectivo%' OR lower(t.payment_method) LIKE '%cash%'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE lower(t.payment_method) LIKE '%tarjeta%' OR lower(t.payment_method) LIKE '%card%'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE lower(t.payment_method) LIKE '%yape%'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE lower(t.payment_method) LIKE '%transferencia%' OR lower(t.payment_method) LIKE '%transfer%'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE lower(t.payment_method) LIKE '%plin%'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(t.payment_method) NOT LIKE '%efectivo%' AND lower(t.payment_method) NOT LIKE '%cash%'
      AND lower(t.payment_method) NOT LIKE '%tarjeta%' AND lower(t.payment_method) NOT LIKE '%card%'
      AND lower(t.payment_method) NOT LIKE '%yape%'
      AND lower(t.payment_method) NOT LIKE '%transferencia%' AND lower(t.payment_method) NOT LIKE '%transfer%'
      AND lower(t.payment_method) NOT LIKE '%plin%'
    ), 0)
  INTO
    v_collected_today, v_collected_yesterday, v_collected_period, v_tickets_paid,
    v_pay_efectivo, v_pay_tarjeta, v_pay_yape, v_pay_transferencia, v_pay_plin, v_pay_otro
  FROM transactions t
  WHERE t.type = 'purchase'
    AND t.is_deleted = false
    AND t.payment_status = 'paid'
    AND t.created_at BETWEEN v_period_start AND v_period_end
    AND (v_eff_school_id IS NULL OR t.school_id = v_eff_school_id);

  -- ============================================================
  -- 4. ANTIGÜEDAD DE LA DEUDA
  -- ============================================================
  SELECT
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) <= 0), 0),
    COUNT(*) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) <= 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) BETWEEN 1 AND 3), 0),
    COUNT(*) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) BETWEEN 1 AND 3),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) BETWEEN 4 AND 7), 0),
    COUNT(*) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) BETWEEN 4 AND 7),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) BETWEEN 8 AND 15), 0),
    COUNT(*) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) BETWEEN 8 AND 15),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) > 15), 0),
    COUNT(*) FILTER (WHERE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - t.created_at AT TIME ZONE 'America/Lima')) > 15)
  INTO
    v_debt_today,  v_count_today,
    v_debt_1to3,   v_count_1to3,
    v_debt_4to7,   v_count_4to7,
    v_debt_8to15,  v_count_8to15,
    v_debt_over15, v_count_over15
  FROM transactions t
  WHERE t.type = 'purchase'
    AND t.is_deleted = false
    AND t.payment_status IN ('pending', 'partial')
    AND (v_eff_school_id IS NULL OR t.school_id = v_eff_school_id);

  -- ============================================================
  -- 5. TOP 15 DEUDORES
  -- ============================================================
  SELECT jsonb_agg(
    jsonb_build_object(
      'name',        COALESCE(tp.full_name, st.full_name, sub.manual_name, 'Sin nombre'),
      'type',        sub.client_type,
      'amount',      sub.total_amount,
      'school_name', COALESCE(s.name, 'Sin sede'),
      'days_overdue',EXTRACT(DAY FROM (NOW() AT TIME ZONE 'America/Lima' - sub.oldest_tx))::integer,
      'count',       sub.tx_count,
      'category',    CASE WHEN sub.has_lunch AND sub.has_cafe THEN 'mixed'
                          WHEN sub.has_lunch THEN 'almuerzo'
                          ELSE 'cafeteria' END
    ) ORDER BY sub.total_amount DESC
  )
  INTO v_top_debtors
  FROM (
    SELECT
      student_id, teacher_id, manual_client_name AS manual_name,
      CASE WHEN teacher_id IS NOT NULL THEN 'teacher'
           WHEN student_id IS NOT NULL THEN 'student'
           ELSE 'manual' END AS client_type,
      school_id,
      SUM(ABS(amount)) AS total_amount,
      COUNT(*) AS tx_count,
      MIN(created_at) AS oldest_tx,
      BOOL_OR((metadata->>'lunch_order_id') IS NOT NULL) AS has_lunch,
      BOOL_OR((metadata->>'lunch_order_id') IS NULL) AS has_cafe
    FROM transactions
    WHERE type = 'purchase'
      AND is_deleted = false
      AND payment_status IN ('pending', 'partial')
      AND (v_eff_school_id IS NULL OR school_id = v_eff_school_id)
    GROUP BY student_id, teacher_id, manual_client_name, school_id
    ORDER BY total_amount DESC
    LIMIT 15
  ) sub
  LEFT JOIN students st ON st.id = sub.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = sub.teacher_id
  LEFT JOIN schools s ON s.id = sub.school_id;

  -- ============================================================
  -- 6. RESUMEN POR SEDE
  -- ============================================================
  SELECT jsonb_agg(
    jsonb_build_object(
      'school_name',      COALESCE(s.name, 'Sin sede'),
      'pending',          COALESCE(sub.pending, 0),
      'lunchPending',     COALESCE(sub.lunch_p, 0),
      'cafeteriaPending', COALESCE(sub.cafe_p,  0),
      'collected',        COALESCE(sub.collected, 0),
      'debtors',          sub.debtors_count
    ) ORDER BY sub.pending DESC
  )
  INTO v_by_school
  FROM (
    SELECT
      school_id,
      SUM(ABS(amount)) FILTER (WHERE payment_status IN ('pending','partial')) AS pending,
      SUM(ABS(amount)) FILTER (WHERE payment_status IN ('pending','partial') AND (metadata->>'lunch_order_id') IS NOT NULL) AS lunch_p,
      SUM(ABS(amount)) FILTER (WHERE payment_status IN ('pending','partial') AND (metadata->>'lunch_order_id') IS NULL) AS cafe_p,
      SUM(ABS(amount)) FILTER (WHERE payment_status = 'paid' AND (metadata->>'source') IS DISTINCT FROM 'pos' AND created_at BETWEEN v_period_start AND v_period_end) AS collected,
      COUNT(DISTINCT COALESCE(student_id::text, teacher_id::text, lower(trim(manual_client_name)))) FILTER (WHERE payment_status IN ('pending','partial')) AS debtors_count
    FROM transactions
    WHERE type = 'purchase'
      AND is_deleted = false
      AND (v_eff_school_id IS NULL OR school_id = v_eff_school_id)
    GROUP BY school_id
  ) sub
  LEFT JOIN schools s ON s.id = sub.school_id;

  -- ============================================================
  -- 7. REEMBOLSOS PENDIENTES
  -- ============================================================
  SELECT COUNT(*), COALESCE(SUM(ABS(amount)), 0)
  INTO v_refund_count, v_refund_amount
  FROM transactions
  WHERE payment_status = 'cancelled'
    AND is_deleted = false
    AND (metadata->>'requires_refund')::boolean = true
    AND (v_eff_school_id IS NULL OR school_id = v_eff_school_id);

  -- ============================================================
  -- ARMAR RESULTADO FINAL
  -- ============================================================
  v_pay_methods_obj := jsonb_build_object(
    'efectivo', v_pay_efectivo, 'tarjeta', v_pay_tarjeta, 'yape', v_pay_yape,
    'transferencia', v_pay_transferencia, 'plin', v_pay_plin, 'otro', v_pay_otro
  );

  v_debt_age_obj := jsonb_build_object(
    'today',      v_debt_today,  'days1to3',  v_debt_1to3,
    'days4to7',   v_debt_4to7,   'days8to15', v_debt_8to15,
    'daysOver15', v_debt_over15,
    'countToday', v_count_today, 'count1to3', v_count_1to3,
    'count4to7',  v_count_4to7,  'count8to15',v_count_8to15,
    'countOver15',v_count_over15
  );

  RETURN jsonb_build_object(
    'totalPending',        ROUND(v_total_pending, 2),
    'lunchPending',        ROUND(v_lunch_pending, 2),
    'cafeteriaPending',    ROUND(v_cafeteria_pending, 2),
    'totalCollectedToday', ROUND(v_collected_today, 2),
    'totalCollectedWeek',  ROUND(v_collected_period, 2),
    'totalCollectedMonth', ROUND(v_collected_period, 2),
    'collectedYesterday',  ROUND(v_collected_yesterday, 2),
    'totalDebtors',        v_total_debtors,
    'totalTicketsPending', v_total_tickets_pending,
    'totalTicketsPaid',    v_tickets_paid,
    'lunchDebtors',        v_lunch_debtors,
    'cafeteriaDebtors',    v_cafeteria_debtors,
    'totalTeacherDebt',    ROUND(v_total_teacher_debt, 2),
    'totalStudentDebt',    ROUND(v_total_student_debt, 2),
    'totalManualDebt',     ROUND(v_total_manual_debt, 2),
    'teacherDebtors',      v_teacher_debtors,
    'studentDebtors',      v_student_debtors,
    'manualDebtors',       v_manual_debtors,
    'debtByAge',           v_debt_age_obj,
    'paymentMethods',      v_pay_methods_obj,
    'topDebtors',          COALESCE(v_top_debtors, '[]'::jsonb),
    'pendingRefunds',      v_refund_count,
    'pendingRefundAmount', ROUND(v_refund_amount, 2),
    'collectionBySchool',  COALESCE(v_by_school, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_billing_dashboard_stats(uuid, date, date)
  TO authenticated, service_role;


-- ============================================================
-- 2. get_billing_consolidated_debtors  (v4 — blindaje de seguridad)
-- ============================================================
DROP FUNCTION IF EXISTS get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer);

CREATE OR REPLACE FUNCTION get_billing_consolidated_debtors(
  p_school_id        uuid        DEFAULT NULL,
  p_until_date       timestamptz DEFAULT NULL,
  p_transaction_type text        DEFAULT NULL,
  p_search           text        DEFAULT NULL,
  p_offset           integer     DEFAULT 0,
  p_limit            integer     DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── VALIDACIÓN DE SEGURIDAD ──────────────────────────────
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_eff_school_id uuid;

  v_total_count integer;
  v_debtors     jsonb;
BEGIN

  -- ============================================================
  -- BLOQUE DE SEGURIDAD
  -- ============================================================
  v_caller_id := auth.uid();

  SELECT role, school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles
  WHERE  id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('total_count', 0, 'debtors', '[]'::jsonb);
  END IF;

  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- ============================================================
  -- Lógica de deudores (idéntica a v3, usando v_eff_school_id)
  -- ============================================================
  WITH

  real_pending AS (
    SELECT
      t.id::text,
      t.amount,
      t.description,
      t.created_at,
      t.payment_status,
      t.metadata,
      t.student_id,
      t.teacher_id,
      t.manual_client_name,
      t.school_id,
      ((t.metadata->>'lunch_order_id') IS NOT NULL) AS is_lunch
    FROM transactions t
    WHERE t.type           = 'purchase'
      AND t.is_deleted     = false
      AND t.payment_status IN ('pending', 'partial')
      AND (v_eff_school_id IS NULL OR t.school_id = v_eff_school_id)
      AND (p_until_date IS NULL OR t.created_at <= p_until_date)
      AND (
        p_transaction_type IS NULL
        OR (p_transaction_type = 'cafeteria' AND (t.metadata->>'lunch_order_id') IS NULL)
        OR (p_transaction_type = 'lunch'     AND (t.metadata->>'lunch_order_id') IS NOT NULL)
      )
  ),

  virtual_lunch AS (
    SELECT
      ('lunch_' || lo.id::text) AS id,
      -ABS(ROUND(
        CASE
          WHEN lo.final_price IS NOT NULL AND lo.final_price > 0 THEN lo.final_price
          WHEN lc.price IS NOT NULL AND lc.price > 0             THEN lc.price * COALESCE(lo.quantity, 1)
          WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0 THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
          ELSE 7.50 * COALESCE(lo.quantity, 1)
        END, 2
      )) AS amount,
      ('Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
        CASE WHEN COALESCE(lo.quantity, 1) > 1 THEN ' (' || COALESCE(lo.quantity, 1)::text || 'x)' ELSE '' END ||
        ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
      ) AS description,
      (lo.order_date::date + interval '17 hours')::timestamptz AS created_at,
      'pending'::text AS payment_status,
      jsonb_build_object(
        'lunch_order_id', lo.id::text,
        'source',         'lunch_order',
        'order_date',     lo.order_date
      ) AS metadata,
      lo.student_id,
      lo.teacher_id,
      lo.manual_name AS manual_client_name,
      COALESCE(lo.school_id, st.school_id, tp.school_id_1) AS school_id,
      true AS is_lunch
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
    LIMIT  p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'total_count', COALESCE(v_total_count, 0),
    'debtors',     COALESCE(v_debtors, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer)
  TO authenticated, service_role;


-- ============================================================
-- 3. get_billing_paid_transactions  (v2 — blindaje de seguridad)
--    Convertida de LANGUAGE sql → plpgsql para poder validar rol
-- ============================================================
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

  -- ── BLOQUE DE SEGURIDAD ──────────────────────────────────
  v_caller_id := auth.uid();

  SELECT role, school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles
  WHERE  id = v_caller_id;

  -- Sin perfil → retornar vacío
  IF v_caller_role IS NULL THEN
    RETURN;
  END IF;

  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- ── Consulta principal (idéntica a v1, usando v_eff_school_id) ──
  RETURN QUERY
  SELECT
    t.id,
    t.type,
    t.amount,
    t.payment_status,
    t.payment_method,
    t.operation_number,
    t.description,
    t.created_at,
    t.school_id,
    s.name          AS school_name,
    t.student_id,
    st.full_name    AS student_full_name,
    st.parent_id    AS student_parent_id,
    t.teacher_id,
    tp.full_name    AS teacher_full_name,
    t.manual_client_name,
    t.metadata,
    t.ticket_code,
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


-- ============================================================
-- 4. count_billing_paid_transactions  (v2 — blindaje de seguridad)
--    Convertida de LANGUAGE sql → plpgsql para poder validar rol
-- ============================================================
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

  -- ── BLOQUE DE SEGURIDAD ──────────────────────────────────
  v_caller_id := auth.uid();

  SELECT role, school_id
  INTO   v_caller_role, v_caller_school
  FROM   profiles
  WHERE  id = v_caller_id;

  -- Sin perfil → 0
  IF v_caller_role IS NULL THEN
    RETURN 0;
  END IF;

  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- ── Conteo principal (idéntico a v1, usando v_eff_school_id) ──
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


-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
-- Ejecuta esto después de aplicar el script para confirmar
-- que las 4 funciones fueron creadas correctamente:
--
-- SELECT proname, prosecdef, proowner::regrole
-- FROM pg_proc
-- WHERE proname IN (
--   'get_billing_dashboard_stats',
--   'get_billing_consolidated_debtors',
--   'get_billing_paid_transactions',
--   'count_billing_paid_transactions'
-- );
--
-- Todas deben tener prosecdef = true (SECURITY DEFINER).
-- ============================================================
SELECT '✅ 20260404_rpc_billing_security_hardening.sql aplicado correctamente — 4 RPCs blindados' AS resultado;
