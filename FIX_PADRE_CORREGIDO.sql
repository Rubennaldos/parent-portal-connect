-- ⚡ ARREGLO RÁPIDO - CONVERTIR A PADRE (CORREGIDO)
-- Copia y pega TODO en Supabase SQL Editor

-- 1️⃣ Cambiar rol a 'parent'
INSERT INTO public.profiles (id, email, role)
SELECT au.id, au.email, 'parent'
FROM auth.users au
WHERE au.email = 'prueba@limacafe28.com'
ON CONFLICT (id) DO UPDATE SET role = 'parent';

-- 2️⃣ Verificar que el perfil se actualizó
SELECT id, email, role FROM public.profiles WHERE email = 'prueba@limacafe28.com';

-- ============================================
-- IMPORTANTE: Ver los estudiantes disponibles
-- ============================================
-- Ejecuta esto para ver qué estudiantes existen:

SELECT id, * FROM public.students WHERE is_active = true LIMIT 10;

-- ============================================
-- 3️⃣ VINCULAR ESTUDIANTES (Manual)
-- ============================================
-- Una vez que veas los IDs de los estudiantes arriba,
-- copia los IDs que quieras vincular y ejecuta:

/*
UPDATE public.students
SET parent_id = (SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com')
WHERE id IN (
  'ID_ESTUDIANTE_1_AQUI',
  'ID_ESTUDIANTE_2_AQUI'
);
*/

-- O si tienes pocos estudiantes, vincular TODOS al padre:
/*
UPDATE public.students
SET parent_id = (SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com')
WHERE parent_id IS NULL;
*/

