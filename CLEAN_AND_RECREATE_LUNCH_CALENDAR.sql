-- ============================================
-- LIMPIEZA Y RECREACIÓN: Sistema de Pedidos de Almuerzo
-- ============================================
-- Limpia todas las funciones viejas y recrea desde cero
-- ============================================

-- 1. ELIMINAR TODAS LAS FUNCIONES RELACIONADAS
DROP FUNCTION IF EXISTS get_student_lunch_orders(UUID, INTEGER, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS get_monthly_lunch_menus(INTEGER, INTEGER, UUID[]) CASCADE;
DROP FUNCTION IF EXISTS get_lunch_calendar_data(UUID, INTEGER, INTEGER) CASCADE;

-- 2. RECREAR LA FUNCIÓN DESDE CERO
CREATE FUNCTION get_student_lunch_orders(
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
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_school_id UUID;
  v_school_name TEXT;
  v_school_color TEXT;
BEGIN
  -- Obtener información del colegio del estudiante
  SELECT s.id, s.name, COALESCE(s.color, '#8B4513')
  INTO v_school_id, v_school_name, v_school_color
  FROM students st
  JOIN schools s ON s.id = st.school_id
  WHERE st.id = p_student_id
  LIMIT 1;

  -- Si no se encuentra, retornar vacío
  IF v_school_id IS NULL THEN
    RETURN;
  END IF;

  -- Retornar los pedidos del estudiante
  RETURN QUERY
  SELECT 
    orders.id::UUID,
    v_school_id::UUID,
    v_school_name::TEXT,
    v_school_color::TEXT,
    orders.order_date::DATE,
    COALESCE(menus.starter, '')::TEXT,
    COALESCE(menus.main_course, '')::TEXT,
    COALESCE(menus.beverage, '')::TEXT,
    COALESCE(menus.dessert, '')::TEXT,
    COALESCE(menus.notes, '')::TEXT,
    COALESCE(menus.is_special_day, false)::BOOLEAN,
    COALESCE(menus.special_day_type, '')::TEXT,
    COALESCE(menus.special_day_title, '')::TEXT,
    orders.status::TEXT
  FROM lunch_orders orders
  LEFT JOIN lunch_menus menus 
    ON menus.school_id = v_school_id 
    AND menus.date = orders.order_date
  WHERE orders.student_id = p_student_id
    AND EXTRACT(MONTH FROM orders.order_date)::INTEGER = target_month
    AND EXTRACT(YEAR FROM orders.order_date)::INTEGER = target_year
    AND orders.status IN ('confirmed', 'pending')
  ORDER BY orders.order_date;
END;
$$;

-- 3. DAR PERMISOS
GRANT EXECUTE ON FUNCTION get_student_lunch_orders(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_student_lunch_orders(UUID, INTEGER, INTEGER) TO anon;

-- 4. VERIFICAR QUE LA FUNCIÓN EXISTE
DO $$ 
BEGIN 
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'get_student_lunch_orders'
  ) THEN
    RAISE NOTICE '✅ Función get_student_lunch_orders creada correctamente';
  ELSE
    RAISE EXCEPTION '❌ Error: La función no se creó correctamente';
  END IF;
END $$;

-- 5. MENSAJE FINAL
DO $$ 
BEGIN 
  RAISE NOTICE '====================================';
  RAISE NOTICE 'Sistema de calendario de almuerzos listo';
  RAISE NOTICE '====================================';
  RAISE NOTICE 'Ahora puedes usar el calendario desde el portal de padres';
  RAISE NOTICE 'Los días aparecerán como "Sin pedido" hasta que se creen pedidos';
END $$;
