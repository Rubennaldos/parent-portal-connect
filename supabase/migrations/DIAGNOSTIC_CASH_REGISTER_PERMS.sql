-- 🔍 DIAGNÓSTICO: Verificar si los permisos de cash_register existen

-- 1️⃣ Ver todos los permisos del módulo cash_register
SELECT 
  id,
  module,
  action,
  name,
  description,
  created_at
FROM permissions
WHERE module = 'cash_register'
ORDER BY action;

-- 2️⃣ Ver cuántos permisos tiene el módulo
SELECT 
  '📊 Total de permisos para cash_register' as info,
  COUNT(*) as total
FROM permissions
WHERE module = 'cash_register';

-- 3️⃣ Ver asignaciones a roles
SELECT 
  rp.role,
  p.action,
  p.name,
  rp.granted
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module = 'cash_register'
ORDER BY rp.role, p.action;

-- 4️⃣ Contar asignaciones por rol
SELECT 
  rp.role,
  COUNT(*) as total_permisos
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.module = 'cash_register'
GROUP BY rp.role
ORDER BY COUNT(*) DESC;
