-- DIAGNÓSTICO Y FIX: Políticas del bucket 'vouchers' en Supabase Storage
-- Ejecutar en SQL Editor de Supabase

-- 1. Ver los buckets que existen
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY name;

-- 2. Ver las políticas actuales del bucket 'vouchers'
SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
ORDER BY policyname;
