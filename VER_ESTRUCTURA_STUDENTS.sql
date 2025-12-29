-- ⚡ VERIFICAR ESTRUCTURA DE LA TABLA STUDENTS
-- Ejecuta esto primero para ver qué columnas existen

-- Ver la estructura de la tabla students
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'students' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Ver todos los estudiantes que existen
SELECT * FROM public.students LIMIT 5;

