-- ⚡ SOLUCIÓN DEFINITIVA: RESETEAR TODO
-- ============================================
-- ⚠️ ADVERTENCIA: Esto eliminará todos los datos de la tabla students
-- Solo ejecuta si estás de acuerdo con perder los datos actuales
-- ============================================

-- PASO 1: Eliminar tabla existente (con CASCADE para eliminar dependencias)
DROP TABLE IF EXISTS public.students CASCADE;

-- PASO 2: Crear tabla correcta desde cero
CREATE TABLE public.students (
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

-- PASO 3: Insertar estudiantes de prueba
INSERT INTO public.students (name, photo_url, balance, daily_limit, grade, section, is_active)
VALUES
  ('Pedro García', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pedro', 50.00, 15.00, '3ro Primaria', 'A', true),
  ('María López', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria', 35.00, 15.00, '4to Primaria', 'B', true),
  ('Juan Pérez', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Juan', 20.00, 15.00, '5to Primaria', 'A', true),
  ('Ana Torres', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ana', 5.00, 10.00, '2do Primaria', 'C', true);

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

-- PASO 5: Convertir prueba@limacafe28.com a padre
INSERT INTO public.profiles (id, email, role)
SELECT au.id, au.email, 'parent'
FROM auth.users au
WHERE au.email = 'prueba@limacafe28.com'
ON CONFLICT (id) DO UPDATE SET role = 'parent';

-- PASO 6: Vincular Pedro y María al padre
UPDATE public.students
SET parent_id = (SELECT id FROM public.profiles WHERE email = 'prueba@limacafe28.com')
WHERE name IN ('Pedro García', 'María López');

-- PASO 7: VERIFICAR TODO
SELECT '=== Perfil ===' as tipo, email, role::text as detalle 
FROM public.profiles 
WHERE email = 'prueba@limacafe28.com'
UNION ALL
SELECT '=== Estudiantes ===' as tipo, s.name, CONCAT('S/ ', s.balance::text, ' - ', p.email) as detalle
FROM public.students s
LEFT JOIN public.profiles p ON s.parent_id = p.id
WHERE p.email = 'prueba@limacafe28.com' OR s.parent_id IS NULL
ORDER BY tipo DESC, detalle;

-- ✅ Deberías ver:
-- - Perfil: role = parent
-- - 2 estudiantes vinculados (Pedro y María)
-- - 2 estudiantes sin vincular (Juan y Ana)

