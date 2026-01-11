-- =====================================================
-- CORREGIR FUNCIÓN get_monthly_lunch_menus
-- =====================================================
-- El problema es que school_name y school_color tienen tipos incorrectos

DROP FUNCTION IF EXISTS get_monthly_lunch_menus(INTEGER, INTEGER, UUID[]);

CREATE OR REPLACE FUNCTION get_monthly_lunch_menus(
  target_month INTEGER,
  target_year INTEGER,
  target_school_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  school_id UUID,
  school_name VARCHAR(200),  -- Cambiar de TEXT a VARCHAR(200)
  school_color VARCHAR(50),  -- Cambiar de TEXT a VARCHAR(50)
  date DATE,
  starter TEXT,
  main_course TEXT,
  beverage TEXT,
  dessert TEXT,
  notes TEXT,
  is_special_day BOOLEAN,
  special_day_type TEXT,
  special_day_title TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lm.id,
    lm.school_id,
    s.name AS school_name,
    s.color AS school_color,
    lm.date,
    lm.starter,
    lm.main_course,
    lm.beverage,
    lm.dessert,
    lm.notes,
    CASE WHEN sd.id IS NOT NULL THEN true ELSE false END AS is_special_day,
    sd.type AS special_day_type,
    sd.title AS special_day_title
  FROM lunch_menus lm
  INNER JOIN schools s ON lm.school_id = s.id
  LEFT JOIN special_days sd ON lm.date = sd.date 
    AND (sd.school_id IS NULL OR sd.school_id = lm.school_id)
  WHERE 
    EXTRACT(MONTH FROM lm.date) = target_month
    AND EXTRACT(YEAR FROM lm.date) = target_year
    AND (target_school_ids IS NULL OR lm.school_id = ANY(target_school_ids))
  ORDER BY lm.date, s.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dar permisos de ejecución
GRANT EXECUTE ON FUNCTION get_monthly_lunch_menus TO authenticated;

