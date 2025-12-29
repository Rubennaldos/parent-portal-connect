-- ============================================
-- ⚡ TODO EN UNO: CREAR TABLAS + CONVERTIR A PADRE
-- Ejecuta TODO este bloque en Supabase SQL Editor
-- ============================================

-- PASO 1: CREAR TABLA STUDENTS (si no existe)
-- ============================================
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id UUID REFERENCES public.profiles(id),
  name VARCHAR(200) NOT NULL,
  photo_url TEXT,
  balance DECIMAL(10,2) DEFAULT 0.00,
  daily_limit DECIMAL(10,2) DEFAULT 10.00,
  grade VARCHAR(50),
  section VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- PASO 2: INSERTAR ESTUDIANTES DE PRUEBA (si no existen)
-- ============================================
INSERT INTO public.students (name, photo_url, balance, daily_limit, grade, section, is_active)
SELECT 
  'Pedro García',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Pedro',
  50.00,
  15.00,
  '3ro Primaria',
  'A',
  true
WHERE NOT EXISTS (SELECT 1 FROM public.students WHERE name = 'Pedro García');

INSERT INTO public.students (name, photo_url, balance, daily_limit, grade, section, is_active)
VALUES
  ('María López', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria', 35.00, 15.00, '4to Primaria', 'B', true),
  ('Juan Pérez', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Juan', 20.00, 15.00, '5to Primaria', 'A', true),
  ('Ana Torres', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ana', 5.00, 10.00, '2do Primaria', 'C', true)
ON CONFLICT DO NOTHING;

-- PASO 3: CAMBIAR ROL A 'parent'
-- ============================================
INSERT INTO public.profiles (id, email, role)
SELECT au.id, au.email, 'parent'
FROM auth.users au
WHERE au.email = 'prueba@limacafe28.com'
ON CONFLICT (id) DO UPDATE SET role = 'parent';

-- PASO 4: VINCULAR ESTUDIANTES AL PADRE
-- ============================================
UPDATE public.students
SET parent_id = (SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com')
WHERE name IN ('Pedro García', 'María López') 
  AND is_active = true;

-- PASO 5: VERIFICAR TODO
-- ============================================
-- Ver el perfil
SELECT '=== PERFIL ===' as info, email, role FROM public.profiles WHERE email = 'prueba@limacafe28.com';

-- Ver los estudiantes vinculados
SELECT 
  '=== HIJOS ===' as info,
  s.name,
  s.balance,
  s.grade,
  p.email as padre
FROM public.students s
LEFT JOIN public.profiles p ON s.parent_id = p.id
WHERE p.email = 'prueba@limacafe28.com';

-- ✅ Deberías ver:
-- - PERFIL: role = 'parent'
-- - HIJOS: Pedro García y María López vinculados

