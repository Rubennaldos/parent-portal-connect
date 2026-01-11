-- =====================================================
-- MEJORAS ALMUERZOS V2 - CALENDARIO Y LIBRERÍA
-- =====================================================

-- 1. TABLA LIBRERÍA DE PLATOS PARA AUTOCOMPLETE
CREATE TABLE IF NOT EXISTS lunch_items_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN ('entrada', 'segundo', 'bebida', 'postre')),
  name TEXT NOT NULL,
  use_count INTEGER DEFAULT 1,
  last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(type, name)
);

CREATE INDEX IF NOT EXISTS idx_lunch_items_library_type ON lunch_items_library(type);
CREATE INDEX IF NOT EXISTS idx_lunch_items_library_name ON lunch_items_library(name);

-- 2. INSERTAR FERIADOS PERÚ 2026 (DEFAULT)
INSERT INTO special_days (date, type, title, description) VALUES
  ('2026-01-01', 'feriado', 'Año Nuevo', 'Feriado Nacional'),
  ('2026-04-02', 'feriado', 'Jueves Santo', 'Semana Santa'),
  ('2026-04-03', 'feriado', 'Viernes Santo', 'Semana Santa'),
  ('2026-05-01', 'feriado', 'Día del Trabajo', 'Feriado Nacional'),
  ('2026-06-07', 'feriado', 'Batalla de Arica y Día de la Bandera', 'Feriado Nacional'),
  ('2026-06-29', 'feriado', 'San Pedro y San Pablo', 'Feriado Nacional'),
  ('2026-07-28', 'feriado', 'Fiestas Patrias', 'Independencia del Perú'),
  ('2026-07-29', 'feriado', 'Fiestas Patrias', 'Día de las Fuerzas Armadas y Policía Nacional'),
  ('2026-08-06', 'feriado', 'Batalla de Junín', 'Feriado Nacional'),
  ('2026-08-30', 'feriado', 'Santa Rosa de Lima', 'Feriado Nacional'),
  ('2026-10-08', 'feriado', 'Combate de Angamos', 'Feriado Nacional'),
  ('2026-11-01', 'feriado', 'Día de Todos los Santos', 'Feriado Nacional'),
  ('2026-12-08', 'feriado', 'Inmaculada Concepción', 'Feriado Nacional'),
  ('2026-12-09', 'feriado', 'Batalla de Ayacucho', 'Feriado Nacional'),
  ('2026-12-25', 'feriado', 'Navidad', 'Feriado Nacional')
ON CONFLICT (date, school_id) DO UPDATE SET 
  type = EXCLUDED.type, 
  title = EXCLUDED.title, 
  description = EXCLUDED.description;

-- 3. FUNCIÓN PARA BUSCAR EN LA LIBRERÍA
CREATE OR REPLACE FUNCTION search_lunch_items(p_type TEXT, p_query TEXT)
RETURNS TABLE (name TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT lil.name
  FROM lunch_items_library lil
  WHERE lil.type = p_type
    AND lil.name ILIKE p_query || '%'
  ORDER BY lil.use_count DESC, lil.name ASC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. FUNCIÓN PARA GUARDAR EN LA LIBRERÍA (LLAMADA AUTOMÁTICAMENTE O MANUALMENTE)
CREATE OR REPLACE FUNCTION upsert_lunch_item(p_type TEXT, p_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF p_name IS NULL OR p_name = '' THEN
    RETURN;
  END IF;

  INSERT INTO lunch_items_library (type, name)
  VALUES (p_type, p_name)
  ON CONFLICT (type, name) DO UPDATE SET
    use_count = lunch_items_library.use_count + 1,
    last_used = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC PARA CAMBIAR ESTADO DE DÍA (TODAS LAS SEDES O INDIVIDUAL)
CREATE OR REPLACE FUNCTION set_day_state(
  p_date DATE,
  p_type TEXT, -- 'feriado', 'no_laborable', 'sin_menu', 'con_menu'
  p_school_ids UUID[] DEFAULT NULL, -- NULL = todas las sedes
  p_title TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_school_id UUID;
BEGIN
  -- Si el tipo es 'sin_menu', eliminamos menús y días especiales
  IF p_type = 'sin_menu' THEN
    IF p_school_ids IS NULL THEN
      DELETE FROM lunch_menus WHERE date = p_date;
      DELETE FROM special_days WHERE date = p_date;
    ELSE
      DELETE FROM lunch_menus WHERE date = p_date AND school_id = ANY(p_school_ids);
      DELETE FROM special_days WHERE date = p_date AND (school_id = ANY(p_school_ids) OR school_id IS NULL);
    END IF;
    RETURN;
  END IF;

  -- Si es feriado o no_laborable
  IF p_type IN ('feriado', 'no_laborable') THEN
    IF p_school_ids IS NULL THEN
      -- Global
      INSERT INTO special_days (date, type, title, school_id)
      VALUES (p_date, p_type, COALESCE(p_title, CASE WHEN p_type = 'feriado' THEN 'Feriado' ELSE 'No Laborable' END), NULL)
      ON CONFLICT (date, school_id) DO UPDATE SET type = EXCLUDED.type, title = EXCLUDED.title;
    ELSE
      -- Por sede
      FOREACH v_school_id IN ARRAY p_school_ids LOOP
        INSERT INTO special_days (date, type, title, school_id)
        VALUES (p_date, p_type, COALESCE(p_title, CASE WHEN p_type = 'feriado' THEN 'Feriado' ELSE 'No Laborable' END), v_school_id)
        ON CONFLICT (date, school_id) DO UPDATE SET type = EXCLUDED.type, title = EXCLUDED.title;
      END LOOP;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. REESCRIBIR RPC PARA OBTENER TODO (MENÚS Y DÍAS ESPECIALES)
CREATE OR REPLACE FUNCTION get_monthly_lunch_menus(
  target_month INTEGER,
  target_year INTEGER,
  target_school_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  school_id UUID,
  school_name TEXT,
  school_color TEXT,
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
  WITH RECURSIVE dates AS (
    SELECT (target_year || '-' || target_month || '-01')::DATE as d
    UNION ALL
    SELECT (d + INTERVAL '1 day')::DATE
    FROM dates
    WHERE EXTRACT(MONTH FROM d + INTERVAL '1 day') = target_month
  ),
  school_list AS (
    SELECT s.id, s.name, s.color
    FROM schools s
    WHERE (target_school_ids IS NULL OR s.id = ANY(target_school_ids))
  )
  SELECT 
    lm.id,
    sl.id as school_id,
    sl.name::TEXT AS school_name,
    sl.color::TEXT AS school_color,
    d.d as date,
    lm.starter,
    lm.main_course,
    lm.beverage,
    lm.dessert,
    lm.notes,
    CASE WHEN sd.id IS NOT NULL THEN true ELSE false END AS is_special_day,
    sd.type AS special_day_type,
    sd.title AS special_day_title
  FROM dates d
  CROSS JOIN school_list sl
  LEFT JOIN lunch_menus lm ON lm.date = d.d AND lm.school_id = sl.id
  LEFT JOIN special_days sd ON sd.date = d.d 
    AND (sd.school_id IS NULL OR sd.school_id = sl.id)
  ORDER BY d.d, sl.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. INSERTAR FINES DE SEMANA 2026 COMO NO LABORABLES POR DEFECTO
DO $$
DECLARE
    d DATE;
BEGIN
    FOR d IN SELECT generate_series('2026-01-01'::DATE, '2026-12-31'::DATE, '1 day'::INTERVAL) LOOP
        IF EXTRACT(DOW FROM d) IN (0, 6) THEN -- 0 = Domingo, 6 = Sábado
            INSERT INTO special_days (date, type, title)
            VALUES (d, 'no_laborable', 'Fin de Semana')
            ON CONFLICT (date, school_id) DO NOTHING;
        END IF;
    END LOOP;
END $$;

-- 9. PERMISOS ADICIONALES
GRANT EXECUTE ON FUNCTION search_lunch_items TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_lunch_item TO authenticated;
GRANT EXECUTE ON FUNCTION set_day_state TO authenticated;
GRANT EXECUTE ON FUNCTION get_monthly_lunch_menus TO authenticated;
