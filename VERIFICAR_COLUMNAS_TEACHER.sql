-- ============================================
-- VERIFICAR COLUMNAS DE teacher_profiles
-- ============================================

-- Ver todas las columnas de teacher_profiles
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'teacher_profiles' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Ver un registro de ejemplo
SELECT * FROM public.teacher_profiles LIMIT 1;

-- Contar total de profesores
SELECT COUNT(*) as total_teachers FROM public.teacher_profiles;

-- Ver el profesor específico de Jean LeBouch (SIN filtrar por email primero)
SELECT *
FROM public.teacher_profiles
LIMIT 5;
