-- ============================================================
-- DIAGNÓSTICO: Estado del bucket vouchers
-- Corre esto primero antes de aplicar el fix
-- ============================================================

-- 1. ¿El bucket vouchers existe y es público?
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'vouchers';

-- 2. ¿Qué políticas tiene el bucket vouchers?
SELECT
  policyname,
  cmd,
  roles,
  qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (qual ILIKE '%vouchers%' OR with_check ILIKE '%vouchers%')
ORDER BY cmd;

-- 3. ¿Cuántos archivos hay en el bucket vouchers?
SELECT COUNT(*) AS total_archivos
FROM storage.objects
WHERE bucket_id = 'vouchers';
