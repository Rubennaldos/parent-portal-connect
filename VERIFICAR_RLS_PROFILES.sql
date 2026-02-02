-- ============================================
-- VERIFICAR RLS EN PROFILES
-- ============================================

-- 1. Ver las políticas RLS de la tabla profiles
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY cmd, policyname;

-- 2. Verificar si RLS está habilitado
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'profiles';

-- 3. Probar lectura directa del perfil
SELECT 
  id,
  email,
  role,
  school_id,
  full_name
FROM public.profiles
WHERE id = 'c0a9dba3-369f-4568-82e3-6d105cdb4406';
