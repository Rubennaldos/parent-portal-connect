-- ===================================
-- AGREGAR PERMISO DE ANALYTICS ALMUERZOS
-- ===================================
-- Script para agregar el permiso de ver analytics en el módulo de almuerzos
-- Fecha: 14 de Enero 2026
-- ===================================

-- Insertar el nuevo permiso si no existe
INSERT INTO permissions (module, action, name, description)
VALUES (
  'almuerzos',
  'ver_dashboard',
  'Ver Analytics',
  'Permite acceder a reportes y estadísticas del módulo de almuerzos'
)
ON CONFLICT (module, action) DO NOTHING;

-- Obtener el ID del permiso recién creado
DO $$
DECLARE
  permission_uuid UUID;
  admin_role_id UUID;
  supervisor_role_id UUID;
BEGIN
  -- Obtener el ID del permiso
  SELECT id INTO permission_uuid
  FROM permissions
  WHERE module = 'almuerzos' AND action = 'ver_dashboard';

  -- Obtener el ID del rol admin_general
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin_general';

  -- Obtener el ID del rol supervisor_red
  SELECT id INTO supervisor_role_id
  FROM roles
  WHERE name = 'supervisor_red';

  -- Asignar el permiso al rol admin_general
  IF permission_uuid IS NOT NULL AND admin_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (admin_role_id, permission_uuid)
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;

  -- Asignar el permiso al rol supervisor_red
  IF permission_uuid IS NOT NULL AND supervisor_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (supervisor_role_id, permission_uuid)
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;
END $$;

-- Verificar que se haya creado correctamente
SELECT 
  p.module,
  p.action,
  p.name,
  p.description,
  COUNT(rp.role_id) as roles_asignados
FROM permissions p
LEFT JOIN role_permissions rp ON p.id = rp.permission_id
WHERE p.module = 'almuerzos' AND p.action = 'ver_dashboard'
GROUP BY p.id, p.module, p.action, p.name, p.description;
