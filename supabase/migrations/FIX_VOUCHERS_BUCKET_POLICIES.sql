-- ============================================================
-- FIX: Políticas del bucket 'vouchers' para que los padres
--      puedan subir sus comprobantes de pago
-- ============================================================
-- PROBLEMA: Los padres reciben "Failed to fetch" al subir vouchers
-- CAUSA: El bucket existe pero sin políticas RLS correctas
-- INSTRUCCIONES: Pegar y ejecutar en Supabase → SQL Editor
-- ============================================================

-- PASO 1: Asegurarse de que el bucket exista y sea público
-- (para que las URLs de los vouchers sean accesibles por el admin)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vouchers',
  'vouchers',
  true,
  10485760, -- 10 MB máximo por archivo
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

-- PASO 2: Limpiar políticas antiguas que puedan estar mal configuradas
DROP POLICY IF EXISTS "padres_subir_vouchers" ON storage.objects;
DROP POLICY IF EXISTS "padres_ver_vouchers" ON storage.objects;
DROP POLICY IF EXISTS "admin_ver_todos_vouchers" ON storage.objects;
DROP POLICY IF EXISTS "admin_borrar_vouchers" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_upload_vouchers" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_vouchers" ON storage.objects;
DROP POLICY IF EXISTS "public_read_vouchers" ON storage.objects;

-- PASO 3: Crear políticas correctas

-- Política 1: Cualquier usuario autenticado puede SUBIR al bucket vouchers
-- (padres, admins — todos necesitan poder subir)
CREATE POLICY "padres_subir_vouchers"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vouchers');

-- Política 2: El dueño del archivo puede VER su propio voucher
CREATE POLICY "padres_ver_sus_vouchers"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'vouchers'
  AND (
    -- El padre ve sus propios archivos (carpeta = su user_id)
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Los admins y supervisores ven todo
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad', 'supervisor_red')
    )
  )
);

-- Política 3: Acceso público para leer (las URLs públicas funcionen sin auth)
-- Esto es necesario porque el admin ve la imagen desde el panel
CREATE POLICY "lectura_publica_vouchers"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'vouchers');

-- Política 4: Solo admins pueden eliminar vouchers
CREATE POLICY "admin_borrar_vouchers"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'vouchers'
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'superadmin')
  )
);

-- ============================================================
-- VERIFICACIÓN: Ejecuta esto para ver que las políticas quedaron
-- ============================================================
-- SELECT policyname, cmd, roles 
-- FROM pg_policies 
-- WHERE tablename = 'objects' 
--   AND schemaname = 'storage'
--   AND policyname ILIKE '%voucher%';
