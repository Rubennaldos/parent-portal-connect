-- =====================================================
-- AGREGAR PERMISOS DE ALCANCE A CONFIGURACIÓN DE PADRES
-- =====================================================

-- Agregar los permisos de alcance (scope) para config_padres
INSERT INTO permissions (module, action, name, description) VALUES
('config_padres', 'ver_su_sede', 'Ver Su Sede', 'Ver solo padres y estudiantes de su sede asignada'),
('config_padres', 'ver_todas_sedes', 'Ver Todas las Sedes', 'Ver padres y estudiantes de todas las sedes'),
('config_padres', 'ver_personalizado', 'Ver Personalizado', 'Seleccionar sedes específicas para visualizar')
ON CONFLICT (module, action) DO UPDATE
SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- =====================================================
-- ASIGNAR PERMISOS DE ALCANCE A ROLES
-- =====================================================

-- ADMIN GENERAL: Ver todas las sedes
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 'admin_general', id, true
FROM permissions
WHERE module = 'config_padres' AND action = 'ver_todas_sedes'
ON CONFLICT (role, permission_id) DO UPDATE
SET granted = true;

-- SUPERVISOR RED: Ver todas las sedes
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 'supervisor_red', id, true
FROM permissions
WHERE module = 'config_padres' AND action = 'ver_todas_sedes'
ON CONFLICT (role, permission_id) DO UPDATE
SET granted = true;

-- GESTOR DE UNIDAD: Ver solo su sede
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 'gestor_unidad', id, true
FROM permissions
WHERE module = 'config_padres' AND action = 'ver_su_sede'
ON CONFLICT (role, permission_id) DO UPDATE
SET granted = true;

-- Verificar los permisos creados
SELECT 
  p.module,
  p.action,
  p.name,
  p.description
FROM permissions p
WHERE p.module = 'config_padres'
ORDER BY p.action;

-- Verificar asignaciones por rol
SELECT 
  rp.role,
  p.module,
  p.action,
  p.name,
  rp.granted
FROM role_permissions rp
JOIN permissions p ON rp.permission_id = p.id
WHERE p.module = 'config_padres'
ORDER BY rp.role, p.action;

