-- =====================================================
-- MEJORAS AL SISTEMA DE ALMUERZOS
-- =====================================================
-- Versión: 1.1
-- Descripción: Agregar colores a sedes, límites de visibilidad para padres,
-- y otras mejoras al sistema de almuerzos

-- =====================================================
-- 1. AGREGAR COLUMNA COLOR A SCHOOLS
-- =====================================================

ALTER TABLE schools ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#10B981';

-- Asignar colores por defecto a las sedes existentes (diferentes colores)
UPDATE schools SET color = CASE 
  WHEN id = (SELECT id FROM schools ORDER BY name LIMIT 1 OFFSET 0) THEN '#10B981' -- Green
  WHEN id = (SELECT id FROM schools ORDER BY name LIMIT 1 OFFSET 1) THEN '#3B82F6' -- Blue
  WHEN id = (SELECT id FROM schools ORDER BY name LIMIT 1 OFFSET 2) THEN '#F59E0B' -- Amber
  WHEN id = (SELECT id FROM schools ORDER BY name LIMIT 1 OFFSET 3) THEN '#8B5CF6' -- Purple
  WHEN id = (SELECT id FROM schools ORDER BY name LIMIT 1 OFFSET 4) THEN '#EF4444' -- Red
  WHEN id = (SELECT id FROM schools ORDER BY name LIMIT 1 OFFSET 5) THEN '#EC4899' -- Pink
  WHEN id = (SELECT id FROM schools ORDER BY name LIMIT 1 OFFSET 6) THEN '#14B8A6' -- Teal
  ELSE '#6B7280' -- Gray por defecto
END
WHERE color IS NULL OR color = '#10B981';

-- =====================================================
-- 2. CONFIGURACIÓN DE VISIBILIDAD DE MENÚS PARA PADRES
-- =====================================================

-- Tabla para configurar cuántos días adelante pueden ver los padres
CREATE TABLE IF NOT EXISTS lunch_menu_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  days_visible_ahead INTEGER DEFAULT 7, -- Cuántos días adelante pueden ver los padres
  show_past_menus BOOLEAN DEFAULT true, -- Si pueden ver menús pasados
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(school_id)
);

-- Insertar configuración por defecto para todas las sedes
INSERT INTO lunch_menu_config (school_id, days_visible_ahead, show_past_menus)
SELECT id, 7, true FROM schools
ON CONFLICT (school_id) DO NOTHING;

-- RLS para lunch_menu_config
ALTER TABLE lunch_menu_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lunch_menu_config_select_policy" ON lunch_menu_config;
CREATE POLICY "lunch_menu_config_select_policy"
  ON lunch_menu_config FOR SELECT
  USING (true); -- Todos pueden leer la configuración

DROP POLICY IF EXISTS "lunch_menu_config_update_policy" ON lunch_menu_config;
CREATE POLICY "lunch_menu_config_update_policy"
  ON lunch_menu_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
    )
  );

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_lunch_menu_config_updated_at ON lunch_menu_config;
CREATE TRIGGER update_lunch_menu_config_updated_at
  BEFORE UPDATE ON lunch_menu_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 3. FUNCIÓN PARA OBTENER MENÚS VISIBLES PARA PADRES
-- =====================================================

CREATE OR REPLACE FUNCTION get_visible_lunch_menus_for_parent(
  target_school_id UUID,
  target_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  id UUID,
  school_id UUID,
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
DECLARE
  config_days_ahead INTEGER;
  config_show_past BOOLEAN;
  min_date DATE;
  max_date DATE;
BEGIN
  -- Obtener configuración de visibilidad para la sede
  SELECT days_visible_ahead, show_past_menus
  INTO config_days_ahead, config_show_past
  FROM lunch_menu_config
  WHERE school_id = target_school_id;

  -- Si no hay configuración, usar valores por defecto
  IF config_days_ahead IS NULL THEN
    config_days_ahead := 7;
    config_show_past := true;
  END IF;

  -- Determinar rango de fechas permitido
  IF config_show_past THEN
    min_date := target_date - INTERVAL '90 days'; -- Hasta 90 días atrás
  ELSE
    min_date := target_date;
  END IF;
  
  max_date := target_date + (config_days_ahead || ' days')::INTERVAL;

  -- Retornar menús dentro del rango permitido
  RETURN QUERY
  SELECT 
    lm.id,
    lm.school_id,
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
  LEFT JOIN special_days sd ON lm.date = sd.date 
    AND (sd.school_id IS NULL OR sd.school_id = lm.school_id)
  WHERE 
    lm.school_id = target_school_id
    AND lm.date >= min_date
    AND lm.date <= max_date
  ORDER BY lm.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dar permisos de ejecución
GRANT EXECUTE ON FUNCTION get_visible_lunch_menus_for_parent TO authenticated;

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================

