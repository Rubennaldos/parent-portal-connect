-- ============================================
-- PASO 1: VERIFICAR PERFIL DEL ADMIN
-- ============================================
SELECT 
  id,
  email,
  role,
  school_id,
  full_name
FROM public.profiles
WHERE email = 'adminjbl@limacafe28.com';
