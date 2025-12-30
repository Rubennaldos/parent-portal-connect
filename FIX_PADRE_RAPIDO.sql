-- ⚡ ARREGLO RÁPIDO - CONVERTIR A PADRE
-- Copia y pega TODO en Supabase SQL Editor

-- 1️⃣ Cambiar rol a 'parent'
INSERT INTO public.profiles (id, email, role)
SELECT au.id, au.email, 'parent'
FROM auth.users au
WHERE au.email = 'prueba@limacafe28.com'
ON CONFLICT (id) DO UPDATE SET role = 'parent';

-- 2️⃣ Vincular estudiantes (Pedro y María)
UPDATE public.students
SET parent_id = (SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com')
WHERE name IN ('Pedro García', 'María López') AND is_active = true;

-- 3️⃣ Verificar (deberías ver role = 'parent' y 2 estudiantes)
SELECT '=== PERFIL ===' as info, id, email, role FROM public.profiles WHERE email = 'prueba@limacafe28.com'
UNION ALL
SELECT '=== HIJOS ===' as info, s.id, s.name, s.balance::text FROM public.students s 
WHERE s.parent_id = (SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com');

-- ✅ Si ves role='parent' y 2 estudiantes, ¡está listo!


