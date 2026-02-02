-- ============================================
-- VERIFICAR ROL DEL USUARIO ADMIN
-- ============================================

-- 1. Ver el perfil del usuario que intentó ver los pedidos
SELECT 
  id,
  email,
  role,
  school_id,
  full_name,
  created_at
FROM public.profiles
WHERE id = 'cfbd3ba1-5c59-4c68-82e3-6d185cdb446c';

-- 2. Ver TODOS los profiles con rol gestor_unidad o admin_general
SELECT 
  id,
  email,
  role,
  school_id,
  full_name,
  created_at
FROM public.profiles
WHERE role IN ('gestor_unidad', 'admin_general')
ORDER BY created_at DESC;

-- 3. Ver si ese usuario tiene relación en auth.users
SELECT 
  au.id,
  au.email,
  au.created_at,
  p.role,
  p.full_name
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE au.id = 'cfbd3ba1-5c59-4c68-82e3-6d185cdb446c';
