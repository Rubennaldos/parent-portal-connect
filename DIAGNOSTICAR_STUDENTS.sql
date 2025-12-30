-- ============================================
-- PASO 1: VER LA ESTRUCTURA ACTUAL DE LA TABLA
-- ============================================
-- Ejecuta SOLO esto primero para ver qué columnas tiene:

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'students' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- También ver qué datos tiene:
SELECT * FROM public.students LIMIT 5;

-- ============================================
-- PASO 2: SOLUCIÓN A - ELIMINAR Y RECREAR
-- (Ejecuta esto SOLO si no tienes datos importantes)
-- ============================================

/*
-- Eliminar tabla existente
DROP TABLE IF EXISTS public.students CASCADE;

-- Crear tabla correcta
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

-- Insertar estudiantes de prueba
INSERT INTO public.students (name, photo_url, balance, daily_limit, grade, section, is_active)
VALUES
  ('Pedro García', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pedro', 50.00, 15.00, '3ro Primaria', 'A', true),
  ('María López', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria', 35.00, 15.00, '4to Primaria', 'B', true),
  ('Juan Pérez', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Juan', 20.00, 15.00, '5to Primaria', 'A', true),
  ('Ana Torres', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ana', 5.00, 10.00, '2do Primaria', 'C', true);
*/

-- ============================================
-- PASO 3: SOLUCIÓN B - AGREGAR COLUMNAS FALTANTES
-- (Si prefieres mantener los datos existentes)
-- ============================================

/*
-- Agrega las columnas que faltan (ajusta según lo que veas en el PASO 1):
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS name VARCHAR(200);
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(10,2) DEFAULT 10.00;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS grade VARCHAR(50);
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS section VARCHAR(50);
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.profiles(id);
*/


