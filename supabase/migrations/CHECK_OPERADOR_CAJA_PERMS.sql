-- 🔍 DIAGNÓSTICO ESPECÍFICO: Permisos del operador_caja para cash_register

-- 1️⃣ Ver TODOS los permisos del operador_caja para cash_register
SELECT 
  '🔍 Permisos de operador_caja para cash_register' as titulo,
  p.action,
  p.name,
  rp.granted,
  rp.created_at
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role = 'operador_caja' 
  AND p.module = 'cash_register'
ORDER BY p.action;

-- 2️⃣ Buscar específicamente el permiso 'access'
SELECT 
  '🎯 Permiso ACCESS para operador_caja' as titulo,
  p.id,
  p.module,
  p.action,
  p.name,
  rp.granted,
  CASE 
    WHEN rp.granted = true THEN '✅ ACTIVO'
    ELSE '❌ INACTIVO'
  END as estado
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role = 'operador_caja'
WHERE p.module = 'cash_register' 
  AND p.action = 'access';

-- 3️⃣ Contar cuántos permisos tiene operador_caja
SELECT 
  '📊 Total de permisos' as info,
  COUNT(*) as total
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role = 'operador_caja' 
  AND p.module = 'cash_register'
  AND rp.granted = true;

-- 4️⃣ Si el resultado de arriba es 0, entonces necesitas ejecutar este INSERT:
/*
INSERT INTO role_permissions (role, permission_id, granted, created_at)
SELECT 
  'operador_caja',
  p.id,
  true,
  NOW()
FROM permissions p
WHERE p.module = 'cash_register' 
  AND p.action IN (
    'access',
    'ver_modulo',
    'ver_dashboard',
    'abrir_caja',
    'cerrar_caja',
    'registrar_ingreso',
    'registrar_egreso',
    'ver_historial',
    'imprimir_reporte',
    'exportar_datos',
    'enviar_whatsapp',
    'ver_su_sede'
  )
ON CONFLICT (role, permission_id) 
DO UPDATE SET granted = true;
*/
