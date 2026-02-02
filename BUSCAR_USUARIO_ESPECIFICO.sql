-- ============================================
-- BUSCAR USUARIO ESPECÍFICO
-- ============================================

-- 1. Buscar por ID exacto
SELECT 
  id,
  email,
  role,
  school_id,
  full_name,
  created_at
FROM public.profiles
WHERE id = 'cfbd3ba1-5c59-4c68-82e3-6d185cdb446c';

-- 2. Si no aparece, ver en auth.users
SELECT 
  au.id,
  au.email,
  au.created_at as auth_created_at,
  au.email_confirmed_at,
  p.id as profile_id,
  p.role,
  p.school_id,
  p.full_name,
  p.created_at as profile_created_at
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE au.id = 'cfbd3ba1-5c59-4c68-82e3-6d185cdb446c';

-- 3. Buscar TODOS los profiles que NO tienen rol
SELECT 
  id,
  email,
  role,
  school_id,
  full_name,
  created_at
FROM public.profiles
WHERE role IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- 4. Si el usuario es PADRE, ver sus datos
SELECT 
  pp.id,
  pp.full_name,
  pp.email,
  pp.phone_1,
  pp.phone_2,
  pp.created_at,
  COUNT(s.id) as total_hijos
FROM public.parent_profiles pp
LEFT JOIN public.students s ON pp.id = s.parent_id
WHERE pp.id = 'cfbd3ba1-5c59-4c68-82e3-6d185cdb446c'
GROUP BY pp.id, pp.full_name, pp.email, pp.phone_1, pp.phone_2, pp.created_at;
