-- ═══════════════════════════════════════════════════════════════════
-- FIX CRÍTICO: check_student_spending_limit
-- 
-- ANTES: Solo verificaba UN tope (el limit_type del estudiante)
--        Si limit_type = 'daily', ignoraba weekly_limit y monthly_limit.
--        Si la función erraba, el POS ignoraba el error y vendía.
--
-- AHORA: Verifica TODOS los topes con valor > 0, sin importar limit_type.
--        Si daily_limit=20, weekly_limit=80, monthly_limit=200,
--        todos se verifican y el más restrictivo bloquea la compra.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS check_student_spending_limit(UUID, NUMERIC);

CREATE OR REPLACE FUNCTION check_student_spending_limit(
  p_student_id UUID,
  p_amount NUMERIC
) RETURNS TABLE (
  can_purchase BOOLEAN,
  limit_type TEXT,
  current_spent NUMERIC,
  limit_amount NUMERIC,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_daily_limit NUMERIC;
  v_weekly_limit NUMERIC;
  v_monthly_limit NUMERIC;
  v_spent_today NUMERIC := 0;
  v_spent_week NUMERIC := 0;
  v_spent_month NUMERIC := 0;
  v_has_any_limit BOOLEAN := false;
BEGIN
  -- Obtener configuración de límites del estudiante
  SELECT
    COALESCE(s.daily_limit, 0),
    COALESCE(s.weekly_limit, 0),
    COALESCE(s.monthly_limit, 0)
  INTO v_daily_limit, v_weekly_limit, v_monthly_limit
  FROM students s
  WHERE s.id = p_student_id;

  -- Si no se encontró el estudiante
  IF NOT FOUND THEN
    RETURN QUERY SELECT true, 'none'::TEXT, 0::NUMERIC, 0::NUMERIC, 'Estudiante no encontrado'::TEXT;
    RETURN;
  END IF;

  -- Verificar si tiene algún tope configurado
  v_has_any_limit := (v_daily_limit > 0) OR (v_weekly_limit > 0) OR (v_monthly_limit > 0);
  
  IF NOT v_has_any_limit THEN
    RETURN QUERY SELECT true, 'none'::TEXT, 0::NUMERIC, 0::NUMERIC, 'Sin límite configurado'::TEXT;
    RETURN;
  END IF;

  -- Calcular gastos (excluyendo almuerzos)
  -- Gasto diario
  IF v_daily_limit > 0 THEN
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_today
    FROM transactions t
    WHERE t.student_id = p_student_id
      AND t.type = 'purchase'
      AND t.created_at >= (CURRENT_DATE AT TIME ZONE 'America/Lima')::TIMESTAMP AT TIME ZONE 'America/Lima'
      AND (t.metadata->>'lunch_order_id') IS NULL;
  END IF;

  -- Gasto semanal
  IF v_weekly_limit > 0 THEN
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_week
    FROM transactions t
    WHERE t.student_id = p_student_id
      AND t.type = 'purchase'
      AND t.created_at >= (date_trunc('week', CURRENT_DATE AT TIME ZONE 'America/Lima'))::TIMESTAMP AT TIME ZONE 'America/Lima'
      AND (t.metadata->>'lunch_order_id') IS NULL;
  END IF;

  -- Gasto mensual
  IF v_monthly_limit > 0 THEN
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_month
    FROM transactions t
    WHERE t.student_id = p_student_id
      AND t.type = 'purchase'
      AND t.created_at >= (date_trunc('month', CURRENT_DATE AT TIME ZONE 'America/Lima'))::TIMESTAMP AT TIME ZONE 'America/Lima'
      AND (t.metadata->>'lunch_order_id') IS NULL;
  END IF;

  -- Verificar cada tope: el primero que exceda bloquea
  -- Prioridad: diario > semanal > mensual
  IF v_daily_limit > 0 AND (v_spent_today + p_amount) > v_daily_limit THEN
    RETURN QUERY SELECT 
      false,
      'daily'::TEXT,
      v_spent_today,
      v_daily_limit,
      ('Límite DIARIO excedido: gastado S/ ' || v_spent_today::TEXT || ' de S/ ' || v_daily_limit::TEXT)::TEXT;
    RETURN;
  END IF;

  IF v_weekly_limit > 0 AND (v_spent_week + p_amount) > v_weekly_limit THEN
    RETURN QUERY SELECT 
      false,
      'weekly'::TEXT,
      v_spent_week,
      v_weekly_limit,
      ('Límite SEMANAL excedido: gastado S/ ' || v_spent_week::TEXT || ' de S/ ' || v_weekly_limit::TEXT)::TEXT;
    RETURN;
  END IF;

  IF v_monthly_limit > 0 AND (v_spent_month + p_amount) > v_monthly_limit THEN
    RETURN QUERY SELECT 
      false,
      'monthly'::TEXT,
      v_spent_month,
      v_monthly_limit,
      ('Límite MENSUAL excedido: gastado S/ ' || v_spent_month::TEXT || ' de S/ ' || v_monthly_limit::TEXT)::TEXT;
    RETURN;
  END IF;

  -- Todos los topes OK → puede comprar
  -- Devolver info del tope más cercano a agotarse
  IF v_daily_limit > 0 THEN
    RETURN QUERY SELECT true, 'daily'::TEXT, v_spent_today, v_daily_limit, 'OK'::TEXT;
  ELSIF v_weekly_limit > 0 THEN
    RETURN QUERY SELECT true, 'weekly'::TEXT, v_spent_week, v_weekly_limit, 'OK'::TEXT;
  ELSIF v_monthly_limit > 0 THEN
    RETURN QUERY SELECT true, 'monthly'::TEXT, v_spent_month, v_monthly_limit, 'OK'::TEXT;
  ELSE
    RETURN QUERY SELECT true, 'none'::TEXT, 0::NUMERIC, 0::NUMERIC, 'OK'::TEXT;
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION check_student_spending_limit(UUID, NUMERIC) TO authenticated, service_role;

SELECT '✅ RPC actualizada: ahora verifica TODOS los topes (diario + semanal + mensual)' AS resultado;
