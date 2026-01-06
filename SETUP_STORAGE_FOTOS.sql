-- =============================================
-- CONFIGURAR STORAGE PARA FOTOS DE ESTUDIANTES
-- =============================================

-- PASO 1: Crear bucket para fotos de estudiantes
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO NOTHING;

-- PASO 2: Eliminar políticas existentes (si las hay)
DROP POLICY IF EXISTS "allow_authenticated_read_student_photos" ON storage.objects;
DROP POLICY IF EXISTS "allow_parents_upload_student_photos" ON storage.objects;
DROP POLICY IF EXISTS "allow_parents_update_student_photos" ON storage.objects;
DROP POLICY IF EXISTS "allow_parents_delete_student_photos" ON storage.objects;

-- PASO 3: Crear políticas de lectura (cualquier usuario autenticado puede ver fotos)
CREATE POLICY "allow_authenticated_read_student_photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'student-photos');

-- PASO 4: Crear política de inserción (usuarios autenticados pueden subir)
CREATE POLICY "allow_parents_upload_student_photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'student-photos');

-- PASO 5: Crear política de actualización
CREATE POLICY "allow_parents_update_student_photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'student-photos')
WITH CHECK (bucket_id = 'student-photos');

-- PASO 6: Crear política de eliminación
CREATE POLICY "allow_parents_delete_student_photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'student-photos');

-- PASO 7: Verificar que el bucket se creó correctamente
SELECT 
  id,
  name,
  public,
  created_at
FROM storage.buckets 
WHERE id = 'student-photos';

-- PASO 8: Verificar políticas creadas
SELECT 
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'objects' 
  AND policyname LIKE '%student_photos%'
ORDER BY policyname;
