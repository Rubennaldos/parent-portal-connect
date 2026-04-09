-- ============================================================
-- RPC: get_ventas_periodo_report
-- Fecha: 2026-04-09
-- Propósito: Reporte de ventas agrupadas por fuente (Quiosco
--   vs Comedor) con desglose de medios de pago.
--
-- LÓGICA DE CIERRE:
--   Se usa created_at como ancla temporal, NUNCA updated_at.
--   Esto garantiza que:
--   1. Solo se incluyen transacciones originadas en el período.
--   2. Conciliaciones o cambios de estado POSTERIORES a date_to
--      no afectan el reporte (filtro estricto created_at <= period_end).
--   3. Timezone: America/Lima (UTC-5) para coherencia operativa.
--   Nota: si una venta del período cambió de 'pending' a 'paid'
--   DESPUÉS de date_to, el reporte mostrará su estado ACTUAL.
--   Para auditorías legales, guardar el PDF del reporte en la
--   fecha de cierre.
-- ============================================================

DROP FUNCTION IF EXISTS get_ventas_periodo_report(uuid, date, date);

CREATE OR REPLACE FUNCTION get_ventas_periodo_report(
  p_school_id  uuid  DEFAULT NULL,
  p_date_from  date  DEFAULT CURRENT_DATE,
  p_date_to    date  DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── CIERRE: ancla temporal en Lima ───────────────────────────────────────
  -- Usando UTC-5 (Lima) para que el "inicio del día" y "fin del día"
  -- sean las 00:00 y 23:59 en el horario de la cafetería.
  v_period_start  timestamptz := (p_date_from::text || 'T00:00:00-05:00')::timestamptz;
  v_period_end    timestamptz := (p_date_to::text   || 'T23:59:59-05:00')::timestamptz;

  -- ── Quiosco (lunch_order_id IS NULL) ─────────────────────────────────────
  v_qk_efectivo      numeric := 0;
  v_qk_digital       numeric := 0;  -- yape + plin + transferencia
  v_qk_tarjeta       numeric := 0;  -- tarjeta débito/crédito
  v_qk_saldo         numeric := 0;  -- saldo prepago del kiosco
  v_qk_mixto         numeric := 0;
  v_qk_otro          numeric := 0;
  v_qk_total_paid    numeric := 0;
  v_qk_total_pending numeric := 0;
  v_qk_cancelled     numeric := 0;
  v_qk_count         integer := 0;

  -- ── Comedor (lunch_order_id IS NOT NULL) ─────────────────────────────────
  v_cd_efectivo      numeric := 0;
  v_cd_digital       numeric := 0;
  v_cd_tarjeta       numeric := 0;
  v_cd_saldo         numeric := 0;
  v_cd_mixto         numeric := 0;
  v_cd_otro          numeric := 0;
  v_cd_total_paid    numeric := 0;
  v_cd_total_pending numeric := 0;
  v_cd_cancelled     numeric := 0;
  v_cd_count         integer := 0;

  -- ── Resultados JSON ───────────────────────────────────────────────────────
  v_by_day    jsonb;
  v_by_school jsonb;
  v_by_hour   jsonb;
BEGIN

  -- ══════════════════════════════════════════════════════════════════════════
  -- 1. QUIOSCO — ventas sin lunch_order_id
  --    CIERRE: filtro estricto por created_at dentro del período Lima
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT
    -- Efectivo
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) LIKE '%efectivo%'
      OR lower(COALESCE(t.payment_method,'')) = 'cash'
    ), 0),
    -- Digital (Yape / Plin / Transferencia)
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) LIKE '%yape%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%plin%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%transferencia%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%transfer%'
    ), 0),
    -- Tarjeta
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) LIKE '%tarjeta%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%card%'
      OR lower(COALESCE(t.payment_method,'')) = 'credito'
      OR lower(COALESCE(t.payment_method,'')) = 'debito'
    ), 0),
    -- Saldo prepago
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) = 'saldo'
    ), 0),
    -- Mixto
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) = 'mixto'
    ), 0),
    -- Pagado
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.payment_status = 'paid'), 0),
    -- Pendiente
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.payment_status IN ('pending','partial')), 0),
    -- Anulado
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.payment_status = 'cancelled'), 0),
    COUNT(*)
  INTO
    v_qk_efectivo, v_qk_digital, v_qk_tarjeta, v_qk_saldo, v_qk_mixto,
    v_qk_total_paid, v_qk_total_pending, v_qk_cancelled, v_qk_count
  FROM transactions t
  WHERE t.type = 'purchase'
    AND t.is_deleted = false
    -- ── CIERRE: ancla por created_at, no por updated_at ─────────────────────
    AND t.created_at >= v_period_start
    AND t.created_at <= v_period_end
    -- ── Fuente: solo Quiosco ────────────────────────────────────────────────
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND (p_school_id IS NULL OR t.school_id = p_school_id);

  -- Calcular "otro" como residuo
  v_qk_otro := GREATEST(0,
    (v_qk_total_paid + v_qk_total_pending)
    - v_qk_efectivo - v_qk_digital - v_qk_tarjeta - v_qk_saldo - v_qk_mixto
  );

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2. COMEDOR — ventas con lunch_order_id
  --    Misma lógica de cierre que Quiosco
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) LIKE '%efectivo%'
      OR lower(COALESCE(t.payment_method,'')) = 'cash'
    ), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) LIKE '%yape%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%plin%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%transferencia%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%transfer%'
    ), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) LIKE '%tarjeta%'
      OR lower(COALESCE(t.payment_method,'')) LIKE '%card%'
      OR lower(COALESCE(t.payment_method,'')) = 'credito'
      OR lower(COALESCE(t.payment_method,'')) = 'debito'
    ), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) = 'saldo'
    ), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE
      lower(COALESCE(t.payment_method,'')) = 'mixto'
    ), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.payment_status = 'paid'), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.payment_status IN ('pending','partial')), 0),
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.payment_status = 'cancelled'), 0),
    COUNT(*)
  INTO
    v_cd_efectivo, v_cd_digital, v_cd_tarjeta, v_cd_saldo, v_cd_mixto,
    v_cd_total_paid, v_cd_total_pending, v_cd_cancelled, v_cd_count
  FROM transactions t
  WHERE t.type = 'purchase'
    AND t.is_deleted = false
    AND t.created_at >= v_period_start
    AND t.created_at <= v_period_end
    -- ── Fuente: solo Comedor ────────────────────────────────────────────────
    AND (t.metadata->>'lunch_order_id') IS NOT NULL
    AND (p_school_id IS NULL OR t.school_id = p_school_id);

  v_cd_otro := GREATEST(0,
    (v_cd_total_paid + v_cd_total_pending)
    - v_cd_efectivo - v_cd_digital - v_cd_tarjeta - v_cd_saldo - v_cd_mixto
  );

  -- ══════════════════════════════════════════════════════════════════════════
  -- 3. RESUMEN POR DÍA (Quiosco + Comedor)
  --    Para gráfico de tendencia día a día
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT jsonb_agg(
    jsonb_build_object(
      'date',     sub.dia,
      'quiosco',  COALESCE(sub.qk, 0),
      'comedor',  COALESCE(sub.cd, 0),
      'total',    COALESCE(sub.qk, 0) + COALESCE(sub.cd, 0),
      'count',    COALESCE(sub.cnt, 0)
    ) ORDER BY sub.dia
  )
  INTO v_by_day
  FROM (
    SELECT
      (t.created_at AT TIME ZONE 'America/Lima')::date AS dia,
      SUM(ABS(t.amount)) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NULL)     AS qk,
      SUM(ABS(t.amount)) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NOT NULL) AS cd,
      COUNT(*) AS cnt
    FROM transactions t
    WHERE t.type = 'purchase'
      AND t.is_deleted = false
      AND t.created_at >= v_period_start
      AND t.created_at <= v_period_end
      AND t.payment_status <> 'cancelled'
      AND (p_school_id IS NULL OR t.school_id = p_school_id)
    GROUP BY dia
  ) sub;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 4. RESUMEN POR SEDE (si p_school_id IS NULL)
  -- ══════════════════════════════════════════════════════════════════════════
  IF p_school_id IS NULL THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'school_name', COALESCE(s.name, 'Sin sede'),
        'quiosco',     COALESCE(sub.qk, 0),
        'comedor',     COALESCE(sub.cd, 0),
        'total',       COALESCE(sub.qk, 0) + COALESCE(sub.cd, 0),
        'paid',        COALESCE(sub.paid, 0),
        'pending',     COALESCE(sub.pending, 0)
      ) ORDER BY (COALESCE(sub.qk, 0) + COALESCE(sub.cd, 0)) DESC
    )
    INTO v_by_school
    FROM (
      SELECT
        t.school_id,
        SUM(ABS(t.amount)) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NULL AND t.payment_status <> 'cancelled')     AS qk,
        SUM(ABS(t.amount)) FILTER (WHERE (t.metadata->>'lunch_order_id') IS NOT NULL AND t.payment_status <> 'cancelled') AS cd,
        SUM(ABS(t.amount)) FILTER (WHERE t.payment_status = 'paid')                                                        AS paid,
        SUM(ABS(t.amount)) FILTER (WHERE t.payment_status IN ('pending','partial'))                                        AS pending
      FROM transactions t
      WHERE t.type = 'purchase'
        AND t.is_deleted = false
        AND t.created_at >= v_period_start
        AND t.created_at <= v_period_end
      GROUP BY t.school_id
    ) sub
    LEFT JOIN schools s ON s.id = sub.school_id;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- RESULTADO FINAL
  -- ══════════════════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(

    -- Metadatos del período y cierre
    'period', jsonb_build_object(
      'from',         p_date_from,
      'to',           p_date_to,
      'generated_at', NOW() AT TIME ZONE 'America/Lima',
      'timezone',     'America/Lima'
    ),

    -- Quiosco
    'quiosco', jsonb_build_object(
      'total',    ROUND(v_qk_total_paid + v_qk_total_pending, 2),
      'paid',     ROUND(v_qk_total_paid,    2),
      'pending',  ROUND(v_qk_total_pending, 2),
      'cancelled',ROUND(v_qk_cancelled,     2),
      'efectivo', ROUND(v_qk_efectivo, 2),
      'digital',  ROUND(v_qk_digital,  2),
      'tarjeta',  ROUND(v_qk_tarjeta,  2),
      'saldo',    ROUND(v_qk_saldo,    2),
      'mixto',    ROUND(v_qk_mixto,    2),
      'otro',     ROUND(v_qk_otro,     2),
      'count',    v_qk_count
    ),

    -- Comedor
    'comedor', jsonb_build_object(
      'total',    ROUND(v_cd_total_paid + v_cd_total_pending, 2),
      'paid',     ROUND(v_cd_total_paid,    2),
      'pending',  ROUND(v_cd_total_pending, 2),
      'cancelled',ROUND(v_cd_cancelled,     2),
      'efectivo', ROUND(v_cd_efectivo, 2),
      'digital',  ROUND(v_cd_digital,  2),
      'tarjeta',  ROUND(v_cd_tarjeta,  2),
      'saldo',    ROUND(v_cd_saldo,    2),
      'mixto',    ROUND(v_cd_mixto,    2),
      'otro',     ROUND(v_cd_otro,     2),
      'count',    v_cd_count
    ),

    -- Gran total
    'grand_total', jsonb_build_object(
      'total',    ROUND(v_qk_total_paid + v_qk_total_pending + v_cd_total_paid + v_cd_total_pending, 2),
      'paid',     ROUND(v_qk_total_paid    + v_cd_total_paid,    2),
      'pending',  ROUND(v_qk_total_pending + v_cd_total_pending, 2),
      'efectivo', ROUND(v_qk_efectivo + v_cd_efectivo, 2),
      'digital',  ROUND(v_qk_digital  + v_cd_digital,  2),
      'tarjeta',  ROUND(v_qk_tarjeta  + v_cd_tarjeta,  2),
      'saldo',    ROUND(v_qk_saldo    + v_cd_saldo,    2),
      'mixto',    ROUND(v_qk_mixto    + v_cd_mixto,    2),
      'otro',     ROUND(v_qk_otro     + v_cd_otro,     2)
    ),

    'by_day',    COALESCE(v_by_day,    '[]'::jsonb),
    'by_school', COALESCE(v_by_school, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_ventas_periodo_report(uuid, date, date)
  TO authenticated, service_role;
