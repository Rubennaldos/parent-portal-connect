-- ============================================
-- FIX: Calendario de Almuerzos para Estudiante
-- ============================================
-- Corrige la función para mostrar solo los
-- almuerzos pedidos por un estudiante específico
-- más los días feriados/no laborables
-- ============================================

-- Eliminar función anterior si existe
DROP FUNCTION IF EXISTS get_student_lunch_orders(UUID, INTEGER, INTEGER);

-- Crear nueva función para obtener pedidos de almuerzo de un estudiante
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
BEGIN
  RETURN QUERY
  SELECT 
    lo.id AS order_id,
    s.id AS school_id,
    s.name AS school_name,
    s.color AS school_color,
    lo.order_date,
    lm.starter,
    lm.main_course,
    lm.beverage,
    lm.dessert,
    lm.notes,
    lm.is_special_day,
    lm.special_day_type,
    lm.special_day_title,
    lo.status AS order_status
  FROM lunch_orders lo
  INNER JOIN students st ON st.id = lo.student_id
  INNER JOIN schools s ON s.id = st.school_id
  LEFT JOIN lunch_menus lm ON lm.school_id = st.school_id AND lm.date = lo.order_date
  WHERE lo.student_id = p_student_id
    AND EXTRACT(MONTH FROM lo.order_date) = target_month
    AND EXTRACT(YEAR FROM lo.order_date) = target_year
    AND lo.status IN ('confirmed', 'pending')
  
  UNION ALL
  
  -- Agregar días especiales (feriados/no laborables) del colegio del estudiante
  SELECT 
    NULL AS order_id,
    lm.school_id,
    s.name AS school_name,
    s.color AS school_color,
    lm.date AS order_date,
    lm.starter,
    lm.main_course,
    lm.beverage,
    lm.dessert,
    lm.notes,
    lm.is_special_day,
    lm.special_day_type,
    lm.special_day_title,
    'special_day' AS order_status
  FROM lunch_menus lm
  INNER JOIN schools s ON s.id = lm.school_id
  WHERE lm.school_id = (SELECT school_id FROM students WHERE id = p_student_id LIMIT 1)
    AND lm.is_special_day = true
    AND EXTRACT(MONTH FROM lm.date) = target_month
    AND EXTRACT(YEAR FROM lm.date) = target_year
  
  ORDER BY order_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dar permisos
GRANT EXECUTE ON FUNCTION get_student_lunch_orders(UUID, INTEGER, INTEGER) TO authenticated;

-- Mensaje final
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Función get_student_lunch_orders creada correctamente';
  RAISE NOTICE 'Esta función muestra solo los pedidos de almuerzo del estudiante más días especiales';
END $$;
