-- =====================================================
-- AGREGAR PERMISO DE ESTADÍSTICAS A COBRANZAS
-- =====================================================

-- Insertar el nuevo permiso
INSERT INTO permissions (module, action, name, description) VALUES
  ('cobranzas', 'ver_estadisticas', 'Ver estadísticas', 'Permite ver estadísticas y análisis de pagos')
ON CONFLICT (module, action) DO NOTHING;

-- Asignar el permiso a admin_general
DO $$
DECLARE
  perm_estadisticas UUID;
BEGIN
  SELECT id INTO perm_estadisticas FROM permissions 
  WHERE module = 'cobranzas' AND action = 'ver_estadisticas';
  
  INSERT INTO role_permissions (role, permission_id, granted) VALUES
    ('admin_general', perm_estadisticas, true)
  ON CONFLICT (role, permission_id) DO UPDATE SET granted = EXCLUDED.granted;
END $$;

