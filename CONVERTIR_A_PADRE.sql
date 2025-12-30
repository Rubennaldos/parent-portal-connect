-- ============================================
-- CONVERTIR USUARIO A PADRE (PARENT)
-- ============================================

-- PASO 1: Ver qué rol tiene actualmente prueba@limacafe28.com
SELECT id, email, role, created_at 
FROM public.profiles 
WHERE email = 'prueba@limacafe28.com';

-- ============================================
-- PASO 2: CAMBIAR el rol a 'parent'
-- ============================================

-- Actualizar o insertar el perfil como 'parent'
INSERT INTO public.profiles (id, email, role)
SELECT 
  au.id,
  au.email,
  'parent'
FROM auth.users au
WHERE au.email = 'prueba@limacafe28.com'
ON CONFLICT (id) 
DO UPDATE SET role = 'parent';

-- ============================================
-- PASO 3: VERIFICAR que se actualizó correctamente
-- ============================================

SELECT id, email, role FROM public.profiles WHERE email = 'prueba@limacafe28.com';

-- Deberías ver: role = 'parent'

-- ============================================
-- PASO 4: VINCULAR ESTUDIANTES AL PADRE
-- (Para que tenga hijos que ver en el Portal)
-- ============================================

-- Ver qué estudiantes existen
SELECT id, name, balance, grade, parent_id 
FROM public.students 
WHERE is_active = true;

-- Vincular Pedro García y María López a este padre
UPDATE public.students
SET parent_id = (
  SELECT id FROM public.profiles 
  WHERE email = 'prueba@limacafe28.com'
)
WHERE name IN ('Pedro García', 'María López')
  AND is_active = true;

-- ============================================
-- PASO 5: VERIFICAR LA VINCULACIÓN
-- ============================================

SELECT 
  s.name as estudiante,
  s.balance,
  s.grade,
  p.email as padre
FROM public.students s
LEFT JOIN public.profiles p ON s.parent_id = p.id
WHERE p.email = 'prueba@limacafe28.com';

-- Deberías ver a Pedro y María vinculados al padre

-- ============================================
-- RESUMEN RÁPIDO (Copia solo esto si quieres ir rápido)
-- ============================================

/*
-- 1️⃣ Cambiar rol a parent
INSERT INTO public.profiles (id, email, role)
SELECT au.id, au.email, 'parent'
FROM auth.users au
WHERE au.email = 'prueba@limacafe28.com'
ON CONFLICT (id) DO UPDATE SET role = 'parent';

-- 2️⃣ Vincular estudiantes
UPDATE public.students
SET parent_id = (SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com')
WHERE name IN ('Pedro García', 'María López') AND is_active = true;

-- 3️⃣ Verificar
SELECT id, email, role FROM public.profiles WHERE email = 'prueba@limacafe28.com';
SELECT s.name, s.balance, p.email FROM public.students s 
LEFT JOIN public.profiles p ON s.parent_id = p.id 
WHERE p.email = 'prueba@limacafe28.com';
*/


