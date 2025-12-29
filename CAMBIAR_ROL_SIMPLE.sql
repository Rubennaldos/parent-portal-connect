-- ============================================
-- SCRIPT SIMPLE: Cambiar a SuperAdmin
-- ============================================
-- Copia y pega esto en Supabase SQL Editor
-- ============================================

-- Cambiar el rol a superadmin
UPDATE public.profiles
SET role = 'superadmin'
WHERE email = 'superadmin@limacafe28.com';

-- Ver el resultado
SELECT id, email, role FROM public.profiles WHERE email = 'superadmin@limacafe28.com';

