-- =====================================================
-- Sistema de Topes de Consumo (Diario, Semanal, Mensual)
-- =====================================================

-- Agregar columnas a la tabla students
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS weekly_limit NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_limit NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS limit_type VARCHAR(20) DEFAULT 'daily';

-- Comentarios
COMMENT ON COLUMN public.students.daily_limit IS 'Límite de consumo diario (ya existía)';
COMMENT ON COLUMN public.students.weekly_limit IS 'Límite de consumo semanal';
COMMENT ON COLUMN public.students.monthly_limit IS 'Límite de consumo mensual';
COMMENT ON COLUMN public.students.limit_type IS 'Tipo de límite activo: daily, weekly, monthly, none';

-- Actualizar valores existentes
UPDATE public.students
SET limit_type = 'daily'
WHERE daily_limit > 0;

UPDATE public.students
SET limit_type = 'none'
WHERE daily_limit = 0 OR daily_limit IS NULL;

-- Mensaje de confirmación
SELECT '✅ Sistema de topes de consumo configurado correctamente' AS status;

-- =====================================================
-- Función para verificar límites antes de una compra
-- =====================================================

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
    COALESCE(limit_type, 'none'),
    COALESCE(daily_limit, 0),
    COALESCE(weekly_limit, 0),
    COALESCE(monthly_limit, 0)
  INTO v_limit_type, v_daily_limit, v_weekly_limit, v_monthly_limit
  FROM students
  WHERE id = p_student_id;

  -- Si no hay límite, permitir compra
  IF v_limit_type = 'none' THEN
    RETURN QUERY SELECT true, 'none'::TEXT, 0::NUMERIC, 0::NUMERIC, 'Sin límite configurado'::TEXT;
    RETURN;
  END IF;

  -- Calcular gasto diario (hoy)
  SELECT COALESCE(SUM(ABS(amount)), 0)
  INTO v_spent_today
  FROM transactions
  WHERE student_id = p_student_id
    AND type = 'purchase'
    AND DATE(created_at) = CURRENT_DATE;

  -- Calcular gasto semanal (esta semana)
  SELECT COALESCE(SUM(ABS(amount)), 0)
  INTO v_spent_this_week
  FROM transactions
  WHERE student_id = p_student_id
    AND type = 'purchase'
    AND DATE(created_at) >= DATE_TRUNC('week', CURRENT_DATE);

  -- Calcular gasto mensual (este mes)
  SELECT COALESCE(SUM(ABS(amount)), 0)
  INTO v_spent_this_month
  FROM transactions
  WHERE student_id = p_student_id
    AND type = 'purchase'
    AND DATE(created_at) >= DATE_TRUNC('month', CURRENT_DATE);

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

-- Comentario
COMMENT ON FUNCTION check_student_spending_limit IS 'Verifica si un estudiante puede realizar una compra según sus límites configurados';

-- Mensaje final
SELECT '✅ Función de verificación de límites creada correctamente' AS status;
