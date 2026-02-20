-- ============================================
-- FIX: Función check_student_spending_limit
-- Error: "column reference limit_type is ambiguous"
-- Causa: variables PL/pgSQL con mismo nombre que columnas
-- Fix: prefijar variables con v_ para evitar ambigüedad
-- ============================================

-- PASO 1: Eliminar función anterior (return type cambió)
DROP FUNCTION IF EXISTS check_student_spending_limit(uuid, numeric);

-- PASO 2: Recrear con variables prefijadas
CREATE OR REPLACE FUNCTION check_student_spending_limit(
  p_student_id UUID,
  p_amount NUMERIC
)
RETURNS TABLE (
  can_purchase BOOLEAN,
  limit_type TEXT,
  limit_amount NUMERIC,
  current_spent NUMERIC,
  remaining NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limit_type TEXT;
  v_daily_limit NUMERIC;
  v_weekly_limit NUMERIC;
  v_monthly_limit NUMERIC;
  v_current_spent NUMERIC := 0;
  v_limit_amount NUMERIC := 0;
BEGIN
  -- Obtener configuración de límites del estudiante
  SELECT 
    s.limit_type,
    COALESCE(s.daily_limit, 0),
    COALESCE(s.weekly_limit, 0),
    COALESCE(s.monthly_limit, 0)
  INTO
    v_limit_type,
    v_daily_limit,
    v_weekly_limit,
    v_monthly_limit
  FROM students s
  WHERE s.id = p_student_id;

  -- Si no tiene límites configurados, permitir compra
  IF v_limit_type IS NULL OR v_limit_type = 'none' THEN
    RETURN QUERY SELECT 
      TRUE AS can_purchase,
      'none'::TEXT AS limit_type,
      0::NUMERIC AS limit_amount,
      0::NUMERIC AS current_spent,
      0::NUMERIC AS remaining;
    RETURN;
  END IF;

  -- Calcular gasto según tipo de límite
  IF v_limit_type = 'daily' THEN
    v_limit_amount := v_daily_limit;
    
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_current_spent
    FROM transactions t
    WHERE t.student_id = p_student_id
      AND t.type = 'purchase'
      AND t.created_at >= (CURRENT_DATE AT TIME ZONE 'America/Lima')::TIMESTAMP AT TIME ZONE 'America/Lima';

  ELSIF v_limit_type = 'weekly' THEN
    v_limit_amount := v_weekly_limit;
    
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_current_spent
    FROM transactions t
    WHERE t.student_id = p_student_id
      AND t.type = 'purchase'
      AND t.created_at >= (date_trunc('week', CURRENT_DATE) AT TIME ZONE 'America/Lima')::TIMESTAMP AT TIME ZONE 'America/Lima';

  ELSIF v_limit_type = 'monthly' THEN
    v_limit_amount := v_monthly_limit;
    
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_current_spent
    FROM transactions t
    WHERE t.student_id = p_student_id
      AND t.type = 'purchase'
      AND t.created_at >= (date_trunc('month', CURRENT_DATE) AT TIME ZONE 'America/Lima')::TIMESTAMP AT TIME ZONE 'America/Lima';
  END IF;

  -- Verificar si puede comprar
  RETURN QUERY SELECT 
    ((v_current_spent + p_amount) <= v_limit_amount) AS can_purchase,
    v_limit_type AS limit_type,
    v_limit_amount AS limit_amount,
    v_current_spent AS current_spent,
    (v_limit_amount - v_current_spent) AS remaining;
  
  RETURN;
END;
$$;

SELECT '✅ Función check_student_spending_limit recreada sin ambigüedad' AS resultado;
