-- =====================================================
-- SISTEMA DE ALMUERZOS CON CALENDARIO
-- =====================================================
-- Versión: 1.0
-- Descripción: Sistema completo de gestión de almuerzos con calendario mensual,
-- soporte para múltiples sedes, días especiales, y estructura de 4 platos

-- =====================================================
-- 1. TABLA DE ALMUERZOS
-- =====================================================

-- Tabla principal de almuerzos (menús diarios por sede)
CREATE TABLE IF NOT EXISTS lunch_menus (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Estructura de 4 platos
  starter TEXT, -- Entrada
  main_course TEXT NOT NULL, -- Segundo (obligatorio)
  beverage TEXT, -- Bebida
  dessert TEXT, -- Postre
  
  -- Metadatos
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: Un menú por día por sede
  UNIQUE(school_id, date)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_lunch_menus_school_date ON lunch_menus(school_id, date);
CREATE INDEX IF NOT EXISTS idx_lunch_menus_date ON lunch_menus(date);
CREATE INDEX IF NOT EXISTS idx_lunch_menus_school ON lunch_menus(school_id);

-- =====================================================
-- 2. TABLA DE DÍAS ESPECIALES
-- =====================================================

-- Tabla para marcar días feriados, no laborables, etc.
CREATE TABLE IF NOT EXISTS special_days (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('feriado', 'no_laborable', 'suspension', 'otro')),
  title TEXT NOT NULL,
  description TEXT,
  
  -- Puede aplicar a todas las sedes o solo algunas
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE, -- NULL = todas las sedes
  
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: Un día especial por fecha por sede (o global si school_id es NULL)
  UNIQUE(date, school_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_special_days_date ON special_days(date);
CREATE INDEX IF NOT EXISTS idx_special_days_school ON special_days(school_id);

-- =====================================================
-- 3. RLS (ROW LEVEL SECURITY)
-- =====================================================

-- Habilitar RLS en las tablas
ALTER TABLE lunch_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE special_days ENABLE ROW LEVEL SECURITY;

-- Políticas para lunch_menus
DROP POLICY IF EXISTS "lunch_menus_select_policy" ON lunch_menus;
CREATE POLICY "lunch_menus_select_policy"
  ON lunch_menus FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('superadmin', 'admin_general', 'supervisor_red', 'gestor_unidad', 'operador_cocina')
        OR (profiles.role = 'parent' AND school_id IN (
          SELECT school_id FROM parent_profiles WHERE id = auth.uid()
        ))
      )
    )
  );

DROP POLICY IF EXISTS "lunch_menus_insert_policy" ON lunch_menus;
CREATE POLICY "lunch_menus_insert_policy"
  ON lunch_menus FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad', 'operador_cocina')
    )
  );

DROP POLICY IF EXISTS "lunch_menus_update_policy" ON lunch_menus;
CREATE POLICY "lunch_menus_update_policy"
  ON lunch_menus FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad', 'operador_cocina')
    )
  );

DROP POLICY IF EXISTS "lunch_menus_delete_policy" ON lunch_menus;
CREATE POLICY "lunch_menus_delete_policy"
  ON lunch_menus FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red')
    )
  );

-- Políticas para special_days
DROP POLICY IF EXISTS "special_days_select_policy" ON special_days;
CREATE POLICY "special_days_select_policy"
  ON special_days FOR SELECT
  USING (true); -- Todos pueden ver días especiales

DROP POLICY IF EXISTS "special_days_insert_policy" ON special_days;
CREATE POLICY "special_days_insert_policy"
  ON special_days FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
    )
  );

DROP POLICY IF EXISTS "special_days_update_policy" ON special_days;
CREATE POLICY "special_days_update_policy"
  ON special_days FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
    )
  );

DROP POLICY IF EXISTS "special_days_delete_policy" ON special_days;
CREATE POLICY "special_days_delete_policy"
  ON special_days FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
    )
  );

-- =====================================================
-- 4. TRIGGER PARA ACTUALIZAR updated_at
-- =====================================================

DROP TRIGGER IF EXISTS update_lunch_menus_updated_at ON lunch_menus;
CREATE TRIGGER update_lunch_menus_updated_at
  BEFORE UPDATE ON lunch_menus
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. PERMISOS DEL MÓDULO DE ALMUERZOS
-- =====================================================

-- Insertar permisos del módulo de almuerzos
INSERT INTO permissions (code, name, description, module) VALUES
  ('almuerzos.ver_modulo', 'Ver módulo de almuerzos', 'Permite acceder al módulo de gestión de almuerzos', 'almuerzos'),
  ('almuerzos.ver_calendario', 'Ver calendario', 'Permite visualizar el calendario de almuerzos', 'almuerzos'),
  ('almuerzos.crear_menu', 'Crear menú', 'Permite crear menús de almuerzo', 'almuerzos'),
  ('almuerzos.editar_menu', 'Editar menú', 'Permite editar menús de almuerzo', 'almuerzos'),
  ('almuerzos.eliminar_menu', 'Eliminar menú', 'Permite eliminar menús de almuerzo', 'almuerzos'),
  ('almuerzos.carga_masiva', 'Carga masiva', 'Permite cargar múltiples menús a la vez', 'almuerzos'),
  ('almuerzos.gestionar_dias_especiales', 'Gestionar días especiales', 'Permite marcar feriados y días no laborables', 'almuerzos'),
  ('almuerzos.ver_su_sede', 'Ver su sede', 'Solo puede ver almuerzos de su propia sede', 'almuerzos'),
  ('almuerzos.ver_todas_sedes', 'Ver todas las sedes', 'Puede ver almuerzos de todas las sedes', 'almuerzos'),
  ('almuerzos.ver_personalizado', 'Ver personalizado', 'Puede seleccionar qué sedes ver', 'almuerzos'),
  ('almuerzos.exportar', 'Exportar', 'Permite exportar menús a Excel/PDF', 'almuerzos')
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- 6. ASIGNAR PERMISOS A ROLES
-- =====================================================

-- Admin General: Acceso completo
INSERT INTO role_permissions (role, permission_code, granted) VALUES
  ('admin_general', 'almuerzos.ver_modulo', true),
  ('admin_general', 'almuerzos.ver_calendario', true),
  ('admin_general', 'almuerzos.crear_menu', true),
  ('admin_general', 'almuerzos.editar_menu', true),
  ('admin_general', 'almuerzos.eliminar_menu', true),
  ('admin_general', 'almuerzos.carga_masiva', true),
  ('admin_general', 'almuerzos.gestionar_dias_especiales', true),
  ('admin_general', 'almuerzos.ver_todas_sedes', true),
  ('admin_general', 'almuerzos.exportar', true)
ON CONFLICT (role, permission_code) DO UPDATE SET granted = EXCLUDED.granted;

-- Supervisor de Red: Acceso completo menos eliminar
INSERT INTO role_permissions (role, permission_code, granted) VALUES
  ('supervisor_red', 'almuerzos.ver_modulo', true),
  ('supervisor_red', 'almuerzos.ver_calendario', true),
  ('supervisor_red', 'almuerzos.crear_menu', true),
  ('supervisor_red', 'almuerzos.editar_menu', true),
  ('supervisor_red', 'almuerzos.carga_masiva', true),
  ('supervisor_red', 'almuerzos.gestionar_dias_especiales', true),
  ('supervisor_red', 'almuerzos.ver_todas_sedes', true),
  ('supervisor_red', 'almuerzos.exportar', true)
ON CONFLICT (role, permission_code) DO UPDATE SET granted = EXCLUDED.granted;

-- Gestor de Unidad: Solo su sede
INSERT INTO role_permissions (role, permission_code, granted) VALUES
  ('gestor_unidad', 'almuerzos.ver_modulo', true),
  ('gestor_unidad', 'almuerzos.ver_calendario', true),
  ('gestor_unidad', 'almuerzos.crear_menu', true),
  ('gestor_unidad', 'almuerzos.editar_menu', true),
  ('gestor_unidad', 'almuerzos.gestionar_dias_especiales', true),
  ('gestor_unidad', 'almuerzos.ver_su_sede', true),
  ('gestor_unidad', 'almuerzos.exportar', true)
ON CONFLICT (role, permission_code) DO UPDATE SET granted = EXCLUDED.granted;

-- Operador de Cocina: Solo lectura de su sede
INSERT INTO role_permissions (role, permission_code, granted) VALUES
  ('operador_cocina', 'almuerzos.ver_modulo', true),
  ('operador_cocina', 'almuerzos.ver_calendario', true),
  ('operador_cocina', 'almuerzos.ver_su_sede', true)
ON CONFLICT (role, permission_code) DO UPDATE SET granted = EXCLUDED.granted;

-- =====================================================
-- 7. FUNCIÓN AUXILIAR: OBTENER MENÚS DEL MES
-- =====================================================

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

-- =====================================================
-- 8. VISTA: RESUMEN MENSUAL DE ALMUERZOS
-- =====================================================

CREATE OR REPLACE VIEW lunch_monthly_summary AS
SELECT 
  DATE_TRUNC('month', date) AS month,
  school_id,
  COUNT(*) AS total_menus,
  COUNT(DISTINCT date) AS days_with_menu,
  COUNT(CASE WHEN starter IS NOT NULL THEN 1 END) AS menus_with_starter,
  COUNT(CASE WHEN dessert IS NOT NULL THEN 1 END) AS menus_with_dessert
FROM lunch_menus
GROUP BY DATE_TRUNC('month', date), school_id;

GRANT SELECT ON lunch_monthly_summary TO authenticated;

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================

