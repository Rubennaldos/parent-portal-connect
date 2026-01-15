-- ===================================
-- AGREGAR PERMISO DE ANALYTICS ALMUERZOS
-- ===================================
-- Script para agregar el permiso de ver analytics en el módulo de almuerzos
-- Fecha: 14 de Enero 2026
-- ===================================

-- 1. Insertar el nuevo permiso si no existe
INSERT INTO permissions (module, action, name, description)
VALUES (
  'almuerzos',
  'ver_dashboard',
  'Ver Analytics',
  'Permite acceder a reportes y estadísticas del módulo de almuerzos'
)
ON CONFLICT (module, action) DO NOTHING;

-- 2. Asignar el permiso a los roles correspondientes
DO $$
DECLARE
  permission_uuid UUID;
BEGIN
  -- Obtener el ID del permiso recién creado
  SELECT id INTO permission_uuid
  FROM permissions
  WHERE module = 'almuerzos' AND action = 'ver_dashboard';

  -- Asignar el permiso al rol admin_general (acceso completo)
  IF permission_uuid IS NOT NULL THEN
    INSERT INTO role_permissions (role, permission_id, granted)
    VALUES ('admin_general', permission_uuid, true)
    ON CONFLICT (role, permission_id) DO UPDATE SET granted = true;
  END IF;

  -- Asignar el permiso al rol supervisor_red (acceso completo)
  IF permission_uuid IS NOT NULL THEN
    INSERT INTO role_permissions (role, permission_id, granted)
    VALUES ('supervisor_red', permission_uuid, true)
    ON CONFLICT (role, permission_id) DO UPDATE SET granted = true;
  END IF;

  -- Asignar el permiso al rol gestor_unidad (solo su sede)
  IF permission_uuid IS NOT NULL THEN
    INSERT INTO role_permissions (role, permission_id, granted)
    VALUES ('gestor_unidad', permission_uuid, true)
    ON CONFLICT (role, permission_id) DO UPDATE SET granted = true;
  END IF;

  RAISE NOTICE '✅ Permiso "ver_dashboard" asignado a: admin_general, supervisor_red, gestor_unidad';
END $$;

-- 3. Verificar que se haya creado correctamente
SELECT 
  p.module,
  p.action,
  p.name,
  p.description,
  COUNT(rp.role) as roles_asignados
FROM permissions p
LEFT JOIN role_permissions rp ON p.id = rp.permission_id
WHERE p.module = 'almuerzos' AND p.action = 'ver_dashboard'
GROUP BY p.id, p.module, p.action, p.name, p.description;

-- 4. Mostrar todos los roles que tienen este permiso
SELECT 
  rp.role,
  p.name as permiso,
  rp.granted
FROM role_permissions rp
INNER JOIN permissions p ON rp.permission_id = p.id
WHERE p.module = 'almuerzos' AND p.action = 'ver_dashboard'
ORDER BY rp.role;
