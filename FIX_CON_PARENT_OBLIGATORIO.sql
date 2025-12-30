-- ⚡ SOLUCIÓN DEFINITIVA - CON PARENT_ID OBLIGATORIO
-- ============================================
-- Tu tabla requiere parent_id al insertar
-- ============================================

-- PASO 1: Agregar columnas faltantes (si no existen)
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS section VARCHAR(50);
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- PASO 2: Convertir prueba@limacafe28.com a padre PRIMERO
INSERT INTO public.profiles (id, email, role)
SELECT au.id, au.email, 'parent'
FROM auth.users au
WHERE au.email = 'prueba@limacafe28.com'
ON CONFLICT (id) DO UPDATE SET role = 'parent';

-- PASO 3: Insertar estudiantes CON parent_id desde el inicio
INSERT INTO public.students (full_name, photo_url, balance, daily_limit, grade, section, is_active, parent_id)
SELECT 
  v.full_name,
  v.photo_url,
  v.balance,
  v.daily_limit,
  v.grade,
  v.section,
  v.is_active,
  p.id as parent_id
FROM (VALUES
  ('Pedro García', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pedro', 50.00, 15.00, '3ro Primaria', 'A', true),
  ('María López', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria', 35.00, 15.00, '4to Primaria', 'B', true),
  ('Juan Pérez', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Juan', 20.00, 15.00, '5to Primaria', 'A', true),
  ('Ana Torres', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ana', 5.00, 10.00, '2do Primaria', 'C', true)
) AS v(full_name, photo_url, balance, daily_limit, grade, section, is_active)
CROSS JOIN (
  SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com'
) p
ON CONFLICT DO NOTHING;

-- PASO 4: Crear tabla transactions (si no existe)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES public.students(id),
  type VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  balance_after DECIMAL(10,2),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- PASO 5: VERIFICAR TODO
SELECT 
  '=== Perfil ===' as tipo, 
  email as detalle1, 
  role as detalle2 
FROM public.profiles 
WHERE email = 'prueba@limacafe28.com'
UNION ALL
SELECT 
  '=== Estudiantes ===' as tipo,
  s.full_name as detalle1,
  CONCAT('S/ ', s.balance::text, ' - ', p.email) as detalle2
FROM public.students s
INNER JOIN public.profiles p ON s.parent_id = p.id
WHERE p.email = 'prueba@limacafe28.com'
ORDER BY tipo DESC, detalle1;

-- ✅ Deberías ver:
-- - Perfil: role = parent
-- - 4 estudiantes vinculados (Pedro, María, Juan, Ana)


