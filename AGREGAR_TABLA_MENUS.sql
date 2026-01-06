-- Tabla para almacenar menús semanales
CREATE TABLE IF NOT EXISTS weekly_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  day_name VARCHAR(20) NOT NULL,
  breakfast TEXT,
  snack_morning TEXT,
  lunch TEXT,
  snack_afternoon TEXT,
  is_visible BOOLEAN DEFAULT true,
  visible_until DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, date)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_weekly_menus_school ON weekly_menus(school_id);
CREATE INDEX IF NOT EXISTS idx_weekly_menus_date ON weekly_menus(date);
CREATE INDEX IF NOT EXISTS idx_weekly_menus_visible ON weekly_menus(is_visible);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_weekly_menus_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_weekly_menus_updated_at
  BEFORE UPDATE ON weekly_menus
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_menus_updated_at();

-- Función para ocultar menús automáticamente basado en visible_until
CREATE OR REPLACE FUNCTION auto_hide_expired_menus()
RETURNS void AS $$
BEGIN
  UPDATE weekly_menus
  SET is_visible = false
  WHERE visible_until IS NOT NULL
    AND visible_until < CURRENT_DATE
    AND is_visible = true;
END;
$$ LANGUAGE plpgsql;

-- Agregar permisos para menús
INSERT INTO permissions (module, action, name, description) VALUES
('productos', 'Gestionar Menús', 'Gestionar Menús', 'Configurar menús del día y planificación semanal')
ON CONFLICT (module, action) DO NOTHING;

-- Asignar permiso al Admin General
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin_general', id FROM permissions WHERE module = 'productos' AND action = 'Gestionar Menús'
ON CONFLICT DO NOTHING;

-- Comentarios para documentación
COMMENT ON TABLE weekly_menus IS 'Almacena los menús semanales por sede escolar';
COMMENT ON COLUMN weekly_menus.visible_until IS 'Fecha límite hasta la cual el menú es visible para los padres';
COMMENT ON COLUMN weekly_menus.is_visible IS 'Controla si el menú es visible para los padres en el momento actual';

