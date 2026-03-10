-- ============================================================================
-- FIX: EXCLUIR ALMUERZOS DEL CÁLCULO DE TOPES DE CONSUMO
-- ============================================================================
-- Los almuerzos que el padre pide por el calendario NO deben contarse
-- como consumo del kiosco. Son dos cajas distintas:
--   1) Kiosco: consumo con cuenta libre (controlado por topes)
--   2) Almuerzos: pago directo del padre (no afecta topes)
--
-- Las transacciones de almuerzo tienen metadata->>'lunch_order_id' NOT NULL
-- ============================================================================

-- Primero eliminar la función existente para evitar conflicto de tipos de retorno
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
) AS $$
DECLARE
  v_limit_type TEXT;
  v_daily_limit NUMERIC;
  v_weekly_limit NUMERIC;
  v_monthly_limit NUMERIC;
  v_spent_today NUMERIC := 0;
  v_spent_this_week NUMERIC := 0;
  v_spent_this_month NUMERIC := 0;
  v_can_buy BOOLEAN := true;
  v_message TEXT := 'OK';
  v_current_spent NUMERIC := 0;
  v_limit_amount NUMERIC := 0;
BEGIN
  -- Obtener configuración de límites del estudiante
  SELECT 
    COALESCE(s.limit_type, 'none'),
    COALESCE(s.daily_limit, 0),
    COALESCE(s.weekly_limit, 0),
    COALESCE(s.monthly_limit, 0)
  INTO v_limit_type, v_daily_limit, v_weekly_limit, v_monthly_limit
  FROM students s
  WHERE s.id = p_student_id;

  -- Si no hay límite, permitir compra
  IF v_limit_type = 'none' THEN
    RETURN QUERY SELECT true, 'none'::TEXT, 0::NUMERIC, 0::NUMERIC, 'Sin límite configurado'::TEXT;
    RETURN;
  END IF;

  -- 🍽️ IMPORTANTE: Excluir transacciones de almuerzo (metadata->>'lunch_order_id' IS NOT NULL)
  -- Los almuerzos son una caja aparte y NUNCA deben afectar los topes del kiosco

  -- Calcular gasto diario (hoy) — SOLO KIOSCO
  SELECT COALESCE(SUM(ABS(amount)), 0)
  INTO v_spent_today
  FROM transactions
  WHERE student_id = p_student_id
    AND type = 'purchase'
    AND DATE(created_at) = CURRENT_DATE
    AND (metadata->>'lunch_order_id') IS NULL;  -- Excluir almuerzos

  -- Calcular gasto semanal (esta semana) — SOLO KIOSCO
  SELECT COALESCE(SUM(ABS(amount)), 0)
  INTO v_spent_this_week
  FROM transactions
  WHERE student_id = p_student_id
    AND type = 'purchase'
    AND DATE(created_at) >= DATE_TRUNC('week', CURRENT_DATE)
    AND (metadata->>'lunch_order_id') IS NULL;  -- Excluir almuerzos

  -- Calcular gasto mensual (este mes) — SOLO KIOSCO
  SELECT COALESCE(SUM(ABS(amount)), 0)
  INTO v_spent_this_month
  FROM transactions
  WHERE student_id = p_student_id
    AND type = 'purchase'
    AND DATE(created_at) >= DATE_TRUNC('month', CURRENT_DATE)
    AND (metadata->>'lunch_order_id') IS NULL;  -- Excluir almuerzos

  -- Verificar según el tipo de límite activo
  CASE v_limit_type
    WHEN 'daily' THEN
      v_current_spent := v_spent_today;
      v_limit_amount := v_daily_limit;
      IF (v_spent_today + p_amount) > v_daily_limit THEN
        v_can_buy := false;
        v_message := 'Límite diario excedido';
      END IF;
      
    WHEN 'weekly' THEN
      v_current_spent := v_spent_this_week;
      v_limit_amount := v_weekly_limit;
      IF (v_spent_this_week + p_amount) > v_weekly_limit THEN
        v_can_buy := false;
        v_message := 'Límite semanal excedido';
      END IF;
      
    WHEN 'monthly' THEN
      v_current_spent := v_spent_this_month;
      v_limit_amount := v_monthly_limit;
      IF (v_spent_this_month + p_amount) > v_monthly_limit THEN
        v_can_buy := false;
        v_message := 'Límite mensual excedido';
      END IF;
      
    ELSE
      v_can_buy := true;
      v_message := 'OK';
  END CASE;

  RETURN QUERY SELECT v_can_buy, v_limit_type, v_current_spent, v_limit_amount, v_message;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permisos
GRANT EXECUTE ON FUNCTION check_student_spending_limit TO authenticated;

SELECT '✅ Función de topes actualizada: los almuerzos ya NO cuentan para el tope del kiosco' as status;
