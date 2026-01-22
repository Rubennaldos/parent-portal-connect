-- ============================================
-- VERIFICAR DATOS DE PADRES
-- Para diagnosticar por qué no aparecen padres
-- ============================================

-- 1. Ver cuántos padres hay en total
SELECT COUNT(*) as total_padres FROM parent_profiles;

-- 2. Ver padres con sus datos básicos
SELECT 
  pp.id,
  pp.full_name,
  pp.nickname,
  pp.dni,
  pp.phone_1,
  pp.school_id,
  s.name as school_name,
  pp.created_at
FROM parent_profiles pp
LEFT JOIN schools s ON s.id = pp.school_id
ORDER BY pp.created_at DESC
LIMIT 20;

-- 3. Ver si hay usuarios con rol 'parent' en profiles
SELECT 
  p.id,
  p.full_name,
  p.role,
  p.school_id,
  s.name as school_name,
  p.created_at
FROM profiles p
LEFT JOIN schools s ON s.id = p.school_id
WHERE p.role = 'parent'
ORDER BY p.created_at DESC
LIMIT 20;

-- 4. Verificar RLS en parent_profiles
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'parent_profiles';

-- 5. Ver si existen sedes
SELECT id, name, code, is_active FROM schools ORDER BY name;

-- 6. Verificar relación parent_profiles <-> profiles
SELECT 
  pp.id as parent_profile_id,
  pp.full_name as parent_name,
  pp.user_id,
  p.id as profile_id,
  p.role as profile_role,
  CASE 
    WHEN p.id IS NULL THEN '❌ NO HAY PERFIL'
    WHEN pp.user_id != p.id THEN '⚠️ IDs NO COINCIDEN'
    ELSE '✅ OK'
  END as status
FROM parent_profiles pp
LEFT JOIN profiles p ON p.id = pp.user_id;
