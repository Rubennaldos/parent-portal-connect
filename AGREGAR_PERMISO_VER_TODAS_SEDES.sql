-- =====================================================
-- AGREGAR PERMISO PARA VER VENTAS DE TODAS LAS SEDES
-- =====================================================
-- Este script agrega un nuevo permiso que permite ver
-- las ventas de todas las sedes en lugar de solo la propia

-- 1. Insertar el nuevo permiso (solo si no existe)
INSERT INTO permissions (module, action, name, description)
VALUES (
  'ventas',
  'Ver Todas las Sedes',
  'ventas.ver_todas_sedes',
  'Permite ver y filtrar ventas de todas las sedes, no solo la propia'
)
ON CONFLICT (module, action) DO NOTHING;

-- 2. Otorgar este permiso por defecto al Admin General
-- (Nota: El Admin General ya tiene acceso hardcoded en el código,
--  pero lo agregamos aquí para coherencia)
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 
  'admin_general',
  id,
  true
FROM permissions
WHERE name = 'ventas.ver_todas_sedes'
ON CONFLICT (role, permission_id) DO UPDATE
SET granted = EXCLUDED.granted;

-- 3. Opcionalmente, otorgarlo también al Supervisor de Red
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 
  'supervisor_red',
  id,
  true
FROM permissions
WHERE name = 'ventas.ver_todas_sedes'
ON CONFLICT (role, permission_id) DO UPDATE
SET granted = EXCLUDED.granted;

-- VERIFICACIÓN
SELECT 
  p.module,
  p.action,
  p.name,
  rp.role,
  rp.granted
FROM permissions p
LEFT JOIN role_permissions rp ON p.id = rp.permission_id
WHERE p.name = 'ventas.ver_todas_sedes'
ORDER BY rp.role;

-- Nota: Los demás roles (gestor_unidad, operador_caja, operador_cocina)
-- NO tendrán este permiso por defecto, pero el Admin General puede
-- otorgárselo manualmente desde el módulo de Control de Acceso.

