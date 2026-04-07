-- ============================================================
-- RPC: get_billing_dashboard_stats  (v2 — fix contable 04-Apr-2026)
-- ============================================================
-- CAMBIOS vs versión anterior:
--
--   BUG 1 — Deudas pendientes ignoraban el histórico:
--     La sección de DEUDA PENDIENTE usaba BETWEEN v_period_start AND v_period_end.
--     Esto excluía deudas anteriores al rango seleccionado, que siguen siendo deuda.
--     FIX: solo se aplica el límite SUPERIOR (v_period_end) a las deudas pendientes.
--          p_date_from solo afecta a métricas de COBROS DEL PERÍODO.
--
--   BUG 2 — Almuerzos virtuales sobreescribían en lugar de acumular:
--     La sección 2 hacía INTO v_lunch_pending sobreescribiendo el valor
--     ya calculado en la sección 1 (almuerzos con transacción).
--     FIX: variables separadas (v_virtual_lunch_pending / v_virtual_lunch_debtors)
--          que se suman al final: total lunch = real + virtual.
--          También se elimina el filtro p_date_from de lunch_orders.
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
  -- Límites para COBROS DEL PERÍODO (ambas fechas aplican)
  v_period_start  timestamptz := (p_date_from::text || 'T00:00:00-05:00')::timestamptz;
  v_period_end    timestamptz := (p_date_to::text   || 'T23:59:59-05:00')::timestamptz;

  -- Límite superior para DEUDA PENDIENTE (solo p_date_to — no excluir historial)
  v_debt_end      timestamptz := (p_date_to::text   || 'T23:59:59-05:00')::timestamptz;

  v_today         date        := CURRENT_DATE AT TIME ZONE 'America/Lima';
  v_yesterday     date        := v_today - interval '1 day';

  -- ── DEUDA PENDIENTE (transacciones reales) ──────────────────
  v_total_pending         numeric := 0;
  v_lunch_pending         numeric := 0;   -- almuerzos con tx real
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
  -- 1. DEUDA PENDIENTE — transacciones reales (type=purchase, pending/partial)
  --    FIX: SIN límite inferior de fecha — toda deuda pendiente hasta p_date_to
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
    -- FIX BUG 1: solo límite superior, sin filtro inferior
    AND t.created_at <= v_debt_end
    AND (p_school_id IS NULL OR t.school_id = p_school_id);

  -- ============================================================
  -- 2. ALMUERZOS VIRTUALES — lunch_orders sin transacción real
  --    FIX BUG 2a: variables SEPARADAS para no sobreescribir sección 1
  --    FIX BUG 2b: solo límite superior en order_date (no FROM)
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
    -- FIX BUG 1+2: solo límite superior de fecha
    AND lo.order_date <= p_date_to
    AND (
      p_school_id IS NULL
      OR lo.school_id = p_school_id
      OR st.school_id = p_school_id
      OR tp.school_id_1 = p_school_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM transactions t2
      WHERE (t2.metadata->>'lunch_order_id') = lo.id::text
        AND t2.is_deleted = false
        AND t2.payment_status IN ('pending', 'partial', 'paid')
    );

  -- FIX BUG 2c: ACUMULAR (no sobreescribir) — total lunch = real + virtual
  v_lunch_pending   := v_lunch_pending + v_virtual_lunch_pending;
  v_lunch_debtors   := v_lunch_debtors + v_virtual_lunch_debtors;
  v_total_pending   := v_total_pending + v_virtual_lunch_pending;
  v_total_debtors   := v_total_debtors + v_virtual_lunch_debtors;

  -- ============================================================
  -- 3. COBROS DEL PERÍODO (paid, excluyendo source='pos')
  --    Aquí SÍ se aplica p_date_from — es un rango de ingresos
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
    AND (p_school_id IS NULL OR t.school_id = p_school_id);

  -- ============================================================
  -- 4. ANTIGÜEDAD DE LA DEUDA
  --    FIX: sin filtro de p_date_from — toda deuda pendiente hasta hoy
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
    -- FIX: sin límite inferior — toda la deuda histórica cuenta
    AND (p_school_id IS NULL OR t.school_id = p_school_id);

  -- ============================================================
  -- 5. TOP 15 DEUDORES (sin filtro de fecha — toda deuda pendiente)
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
      AND (p_school_id IS NULL OR school_id = p_school_id)
    GROUP BY student_id, teacher_id, manual_client_name, school_id
    ORDER BY total_amount DESC
    LIMIT 15
  ) sub
  LEFT JOIN students st ON st.id = sub.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = sub.teacher_id
  LEFT JOIN schools s ON s.id = sub.school_id;

  -- ============================================================
  -- 6. RESUMEN POR SEDE
  --    Pending: sin filtro de fecha (toda deuda histórica)
  --    Collected: con filtro de período (solo ingresos del rango)
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
      -- FIX: sin filtro de fecha inferior para pending
      SUM(ABS(amount)) FILTER (WHERE payment_status IN ('pending','partial')) AS pending,
      SUM(ABS(amount)) FILTER (WHERE payment_status IN ('pending','partial') AND (metadata->>'lunch_order_id') IS NOT NULL) AS lunch_p,
      SUM(ABS(amount)) FILTER (WHERE payment_status IN ('pending','partial') AND (metadata->>'lunch_order_id') IS NULL) AS cafe_p,
      -- Collected sí usa el rango del período
      SUM(ABS(amount)) FILTER (WHERE payment_status = 'paid' AND (metadata->>'source') IS DISTINCT FROM 'pos' AND created_at BETWEEN v_period_start AND v_period_end) AS collected,
      COUNT(DISTINCT COALESCE(student_id::text, teacher_id::text, lower(trim(manual_client_name)))) FILTER (WHERE payment_status IN ('pending','partial')) AS debtors_count
    FROM transactions
    WHERE type = 'purchase'
      AND is_deleted = false
      AND (p_school_id IS NULL OR school_id = p_school_id)
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
    AND (p_school_id IS NULL OR school_id = p_school_id);

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
