-- =====================================================
-- CONFIGURACIÓN: Storage Bucket para Logos de Impresoras
-- Descripción: Crear bucket de almacenamiento para logos
-- Instrucciones: Ejecutar en Supabase Dashboard > Storage
-- =====================================================

/*
  PASO 1: Crear el bucket "school-assets" en Supabase Storage
  
  1. Ve a Supabase Dashboard > Storage
  2. Click en "Create a new bucket"
  3. Nombre: school-assets
  4. Public: ✅ Activado (para que los logos sean accesibles públicamente)
  5. Click en "Create bucket"
*/

-- PASO 2: Configurar políticas de acceso al bucket
-- Ejecutar estos comandos en SQL Editor:

-- Policy: Permitir lectura pública (para mostrar logos en tickets)
CREATE POLICY "Public read access for school assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'school-assets');

-- Policy: SuperAdmin puede subir archivos
CREATE POLICY "SuperAdmin can upload school assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'school-assets'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'superadmin'
  )
);

-- Policy: SuperAdmin puede actualizar archivos
CREATE POLICY "SuperAdmin can update school assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'school-assets'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'superadmin'
  )
);

-- Policy: SuperAdmin puede eliminar archivos
CREATE POLICY "SuperAdmin can delete school assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'school-assets'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'superadmin'
  )
);

-- Verificar que las políticas se crearon correctamente
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects'
AND policyname LIKE '%school%';

/*
  PASO 3: Configurar límites del bucket (Opcional)
  
  En Supabase Dashboard > Storage > school-assets > Settings:
  
  - File size limit: 2 MB (para logos)
  - Allowed MIME types: image/png, image/jpeg, image/svg+xml, image/webp
*/

-- NOTAS IMPORTANTES:
-- 1. Los logos se almacenarán en la carpeta "printer-logos/" dentro del bucket
-- 2. El nombre de cada archivo incluirá el school_id para evitar conflictos
-- 3. Los archivos anteriores se sobrescribirán automáticamente (upsert: true)
-- 4. Las URLs públicas de los logos se almacenarán en printer_configs.logo_url
