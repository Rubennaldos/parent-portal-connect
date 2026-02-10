-- =====================================================
-- BUSCAR LOS USUARIOS ESPECÍFICOS QUE CREARON LOS PAGOS
-- =====================================================

-- 1️⃣ Buscar los UUIDs específicos en profiles
SELECT 
  '👤 USUARIOS ESPECÍFICOS' as tipo,
  p.id,
  p.full_name,
  p.email,
  p.role,
  s.name as school_name,
  p.school_id
FROM profiles p
LEFT JOIN schools s ON p.school_id = s.id
WHERE p.id IN (
  '50214926-135f-4562-879d-8abb5c5389ec',
  '3b35733e-9248-440e-90c0-236681719b3c'
);

-- 2️⃣ Ver todos los roles que existen en profiles
SELECT 
  '📊 ROLES EXISTENTES' as tipo,
  role,
  COUNT(*) as cantidad
FROM profiles
WHERE role IS NOT NULL
GROUP BY role
ORDER BY cantidad DESC;

-- 3️⃣ Ver ejemplos de cada tipo de rol con su sede
SELECT 
  '🔍 EJEMPLOS POR ROL' as tipo,
  p.full_name,
  p.email,
  p.role,
  s.name as school_name
FROM profiles p
LEFT JOIN schools s ON p.school_id = s.id
WHERE p.role IN ('admin', 'billing_admin', 'cashier', 'kitchen', 'teacher', 'parent')
ORDER BY p.role, p.full_name
LIMIT 20;
