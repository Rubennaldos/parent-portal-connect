-- ============================================
-- FIX: Función simplificada para pedidos de almuerzo
-- ============================================
-- Versión simplificada sin UNION para evitar errores
-- ============================================

-- Eliminar función anterior
DROP FUNCTION IF EXISTS get_student_lunch_orders(UUID, INTEGER, INTEGER);

-- Crear función simplificada
CREATE OR REPLACE FUNCTION get_student_lunch_orders(
  p_student_id UUID,
  target_month INTEGER,
  target_year INTEGER
)
RETURNS TABLE (
  order_id UUID,
  school_id UUID,
  school_name TEXT,
  school_color TEXT,
  order_date DATE,
  starter TEXT,
  main_course TEXT,
  beverage TEXT,
  dessert TEXT,
  notes TEXT,
  is_special_day BOOLEAN,
  special_day_type TEXT,
  special_day_title TEXT,
  order_status TEXT
) AS $$
DECLARE
  v_school_id UUID;
BEGIN
  -- Obtener el school_id del estudiante
  SELECT st.school_id INTO v_school_id
  FROM students st
  WHERE st.id = p_student_id
  LIMIT 1;

  -- Si no se encuentra el estudiante, retornar vacío
  IF v_school_id IS NULL THEN
    RETURN;
  END IF;

  -- Retornar pedidos del estudiante con información del menú
  RETURN QUERY
  SELECT 
    lo.id,
    v_school_id,
    s.name,
    COALESCE(s.color, '#8B4513'),
    lo.order_date,
    COALESCE(lm.starter, ''),
    COALESCE(lm.main_course, ''),
    COALESCE(lm.beverage, ''),
    COALESCE(lm.dessert, ''),
    COALESCE(lm.notes, ''),
    COALESCE(lm.is_special_day, false),
    COALESCE(lm.special_day_type, ''),
    COALESCE(lm.special_day_title, ''),
    lo.status
  FROM lunch_orders lo
  CROSS JOIN schools s
  LEFT JOIN lunch_menus lm 
    ON lm.school_id = v_school_id 
    AND lm.date = lo.order_date
  WHERE lo.student_id = p_student_id
    AND s.id = v_school_id
    AND EXTRACT(MONTH FROM lo.order_date) = target_month
    AND EXTRACT(YEAR FROM lo.order_date) = target_year
    AND lo.status IN ('confirmed', 'pending')
  ORDER BY lo.order_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dar permisos
GRANT EXECUTE ON FUNCTION get_student_lunch_orders(UUID, INTEGER, INTEGER) TO authenticated;

-- Mensaje final
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Función get_student_lunch_orders simplificada creada';
END $$;
