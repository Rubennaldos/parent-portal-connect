-- ⚡ SOLUCIÓN DEFINITIVA: AGREGAR ALIAS Y LIMPIAR CACHÉ
-- Este script arregla el error "column students.name does not exist"

-- OPCIÓN 1: Agregar columna "name" como alias de "full_name"
-- (Esto hace que ambos nombres funcionen)
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS name VARCHAR(200);

-- Copiar datos de full_name a name
UPDATE public.students SET name = full_name WHERE name IS NULL;

-- Sincronizar ambas columnas automáticamente (trigger)
CREATE OR REPLACE FUNCTION sync_student_names()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.full_name IS NOT NULL THEN
    NEW.name := NEW.full_name;
  END IF;
  IF NEW.name IS NOT NULL THEN
    NEW.full_name := NEW.name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_student_names_trigger ON public.students;
CREATE TRIGGER sync_student_names_trigger
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION sync_student_names();

-- Verificar que ambas columnas existen
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'students' 
  AND table_schema = 'public'
  AND column_name IN ('name', 'full_name')
ORDER BY column_name;

-- Ver estudiantes
SELECT id, name, full_name, grade, balance FROM public.students LIMIT 5;

-- ✅ Ahora tanto "name" como "full_name" funcionarán


