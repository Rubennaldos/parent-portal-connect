-- ============================================
-- VERIFICAR ESTRUCTURA teacher_profiles
-- ============================================

-- Ver todas las columnas
SELECT column_name, data_type
FROM information_schema.columns 
WHERE table_name = 'teacher_profiles' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Ver un registro de ejemplo (todos los campos)
SELECT * FROM public.teacher_profiles LIMIT 1;

-- Contar total de profesores
SELECT COUNT(*) as total_profesores FROM public.teacher_profiles;
