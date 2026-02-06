-- 🔍 VERIFICAR PERMISOS DE CIERRE DE CAJA

-- 1. Ver si el permiso existe
SELECT 
  id,
  module,
  action,
  name,
  description
FROM permissions
WHERE module = 'cash_register'
ORDER BY action;

-- 2. Ver roles asignados
SELECT 
  rp.role,
  p.module,
  p.action,
  p.name,
  rp.granted
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module = 'cash_register'
ORDER BY rp.role;

-- 3. Ver TODOS los permisos de admin_general
SELECT 
  p.module,
  p.action,
  p.name,
  rp.granted
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role = 'admin_general'
ORDER BY p.module;

-- 4. Ver TODOS los módulos/permisos que existen
SELECT DISTINCT
  p.module,
  COUNT(*) as total_permisos
FROM permissions p
GROUP BY p.module
ORDER BY p.module;
