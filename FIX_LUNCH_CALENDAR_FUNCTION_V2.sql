-- Eliminar función anterior
DROP FUNCTION IF EXISTS get_monthly_lunch_menus(integer, integer, uuid[]);

-- Crear función correcta con las columnas reales
CREATE OR REPLACE FUNCTION get_monthly_lunch_menus(
  target_month integer,
  target_year integer,
  target_school_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  date date,
  starter text,
  main_course text,
  beverage text,
  dessert text,
  notes text,
  school_id uuid,
  school_name text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lm.id,
    lm.date,
    lm.starter,
    lm.main_course,
    lm.beverage,
    lm.dessert,
    lm.notes,
    lm.school_id,
    s.name::text as school_name
  FROM lunch_menus lm
  LEFT JOIN schools s ON s.id = lm.school_id
  WHERE 
    EXTRACT(MONTH FROM lm.date) = target_month
    AND EXTRACT(YEAR FROM lm.date) = target_year
    AND (
      target_school_ids IS NULL 
      OR lm.school_id = ANY(target_school_ids)
    )
  ORDER BY lm.date, s.name;
END;
$$;
