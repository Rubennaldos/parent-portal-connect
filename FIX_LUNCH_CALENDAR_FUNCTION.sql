-- Arreglar el tipo de retorno de get_monthly_lunch_menus
-- El problema es que alguna columna devuelve varchar(200) en lugar de text

-- Primero, eliminar la función existente
DROP FUNCTION IF EXISTS get_monthly_lunch_menus(integer, integer, uuid[]);

-- Recrear la función con los tipos correctos
CREATE OR REPLACE FUNCTION get_monthly_lunch_menus(
  target_month integer,
  target_year integer,
  target_school_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  date date,
  menu_name text,  -- Asegurar que sea text, no varchar
  description text,
  price numeric,
  is_special_day boolean,
  special_day_type text,  -- Asegurar que sea text, no varchar
  special_day_title text,  -- Asegurar que sea text, no varchar
  school_id uuid,
  school_name text,  -- Asegurar que sea text, no varchar
  is_active boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lm.id,
    lm.date,
    lm.menu_name::text,  -- Cast explícito a text
    lm.description::text,
    lm.price,
    lm.is_special_day,
    lm.special_day_type::text,  -- Cast explícito a text
    lm.special_day_title::text,  -- Cast explícito a text
    lm.school_id,
    s.name::text as school_name,  -- Cast explícito a text
    lm.is_active
  FROM lunch_menus lm
  LEFT JOIN schools s ON s.id = lm.school_id
  WHERE 
    EXTRACT(MONTH FROM lm.date) = target_month
    AND EXTRACT(YEAR FROM lm.date) = target_year
    AND (
      target_school_ids IS NULL 
      OR lm.school_id = ANY(target_school_ids)
    )
    AND lm.is_active = true
  ORDER BY lm.date, s.name;
END;
$$;
