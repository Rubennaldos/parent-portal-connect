-- ============================================
-- AGREGAR ESTUDIANTES REALES
-- ============================================
-- Instrucciones:
-- 1. Edita los datos de cada estudiante (nombre, grado, saldo, etc.)
-- 2. Cambia el email del padre si es diferente a 'prueba@limacafe28.com'
-- 3. Ejecuta TODO el script en Supabase

-- ============================================
-- ESTUDIANTE 1
-- ============================================
INSERT INTO public.students (
  full_name,
  grade,
  section,
  balance,
  daily_limit,
  parent_id,
  is_active
)
SELECT 
  'Nombre Completo del Estudiante 1',  -- ← CAMBIA ESTO
  '1ro Primaria',                      -- ← CAMBIA ESTO (ej: '1ro', '2do', '3ro', '4to', '5to', '6to')
  'A',                                 -- ← CAMBIA ESTO (ej: 'A', 'B', 'C')
  0.00,                                -- ← Saldo inicial (puedes dejarlo en 0)
  15.00,                               -- ← Límite diario en soles
  p.id,
  true
FROM public.profiles p
WHERE p.email = 'prueba@limacafe28.com';  -- ← CAMBIA por tu email

-- ============================================
-- ESTUDIANTE 2
-- ============================================
INSERT INTO public.students (
  full_name,
  grade,
  section,
  balance,
  daily_limit,
  parent_id,
  is_active
)
SELECT 
  'Nombre Completo del Estudiante 2',  -- ← CAMBIA ESTO
  '3ro Primaria',                      -- ← CAMBIA ESTO
  'B',                                 -- ← CAMBIA ESTO
  0.00,                                -- ← Saldo inicial
  15.00,                               -- ← Límite diario
  p.id,
  true
FROM public.profiles p
WHERE p.email = 'prueba@limacafe28.com';  -- ← CAMBIA por tu email

-- ============================================
-- ESTUDIANTE 3 (Opcional - copia este bloque si tienes más hijos)
-- ============================================
INSERT INTO public.students (
  full_name,
  grade,
  section,
  balance,
  daily_limit,
  parent_id,
  is_active
)
SELECT 
  'Nombre Completo del Estudiante 3',  -- ← CAMBIA ESTO
  '5to Primaria',                      -- ← CAMBIA ESTO
  'A',                                 -- ← CAMBIA ESTO
  0.00,                                -- ← Saldo inicial
  15.00,                               -- ← Límite diario
  p.id,
  true
FROM public.profiles p
WHERE p.email = 'prueba@limacafe28.com';  -- ← CAMBIA por tu email

-- ============================================
-- VERIFICAR QUE SE AGREGARON
-- ============================================
SELECT 
  s.full_name as estudiante,
  s.grade as grado,
  s.section as seccion,
  s.balance as saldo,
  s.daily_limit as limite_diario,
  p.email as padre
FROM public.students s
INNER JOIN public.profiles p ON s.parent_id = p.id
WHERE p.email = 'prueba@limacafe28.com'  -- ← CAMBIA por tu email
ORDER BY s.full_name;

-- ✅ Deberías ver tus estudiantes listados aquí


