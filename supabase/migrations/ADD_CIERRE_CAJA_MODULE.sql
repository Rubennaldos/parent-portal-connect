-- 🔐 ASIGNAR PERMISOS AL MÓDULO DE CIERRE DE CAJA
-- Este script debe ejecutarse DESPUÉS de:
-- 1. CREATE_PERMISSIONS_SYSTEM.sql
-- 2. INSERT_ALL_MODULES.sql

-- ============================================
-- ASIGNAR PERMISOS POR ROL
-- ============================================

-- 1. Admin General - Acceso Total (automático, pero lo registramos por completitud)
INSERT INTO role_permissions (role, module_code, action_code, can_access)
SELECT 
  'admin_general',
  'cierre_caja',
  action_code,
  true
FROM module_actions
WHERE module_code = 'cierre_caja'
ON CONFLICT (role, module_code, action_code) DO UPDATE SET
  can_access = true;

-- 2. Admin por Sede - Acceso Total
INSERT INTO role_permissions (role, module_code, action_code, can_access)
SELECT 
  'admin',
  'cierre_caja',
  action_code,
  true
FROM module_actions
WHERE module_code = 'cierre_caja'
ON CONFLICT (role, module_code, action_code) DO UPDATE SET
  can_access = true;

-- 3. Operador de Caja - Todo excepto configurar
INSERT INTO role_permissions (role, module_code, action_code, can_access)
VALUES 
  ('operador_caja', 'cierre_caja', 'ver_modulo', true),
  ('operador_caja', 'cierre_caja', 'abrir_caja', true),
  ('operador_caja', 'cierre_caja', 'ver_dashboard', true),
  ('operador_caja', 'cierre_caja', 'registrar_ingreso', true),
  ('operador_caja', 'cierre_caja', 'registrar_egreso', true),
  ('operador_caja', 'cierre_caja', 'cerrar_caja', true),
  ('operador_caja', 'cierre_caja', 'ver_historial', true),
  ('operador_caja', 'cierre_caja', 'imprimir', true),
  ('operador_caja', 'cierre_caja', 'exportar', true),
  ('operador_caja', 'cierre_caja', 'configurar', false) -- ❌ No puede configurar
ON CONFLICT (role, module_code, action_code) DO UPDATE SET
  can_access = EXCLUDED.can_access;

-- ============================================
-- VERIFICACIÓN
-- ============================================

-- Ver módulo registrado
SELECT 
  m.code,
  m.name,
  m.status,
  m.route
FROM modules m
WHERE m.code = 'cierre_caja';

-- Ver acciones del módulo
SELECT 
  ma.action_code,
  ma.name,
  ma.description
FROM module_actions ma
WHERE ma.module_code = 'cierre_caja'
ORDER BY ma.name;

-- Ver permisos asignados por rol
SELECT 
  rp.role,
  rp.action_code,
  rp.can_access
FROM role_permissions rp
WHERE rp.module_code = 'cierre_caja'
ORDER BY rp.role, rp.action_code;

-- Resumen de permisos
SELECT 
  rp.role,
  COUNT(*) FILTER (WHERE rp.can_access = true) as permisos_activos,
  COUNT(*) as total_acciones
FROM role_permissions rp
WHERE rp.module_code = 'cierre_caja'
GROUP BY rp.role
ORDER BY rp.role;

SELECT '✅ Permisos de Cierre de Caja configurados exitosamente' as message;
