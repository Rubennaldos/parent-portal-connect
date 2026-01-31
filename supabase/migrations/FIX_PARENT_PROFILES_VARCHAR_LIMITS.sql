-- ============================================
-- FIX: Corregir límites de VARCHAR en parent_profiles
-- ============================================
-- Error: "value too long for type character varying(8)"
-- Este script identifica y corrige campos con límites muy cortos

-- 1. Verificar la estructura actual de parent_profiles
-- (Ejecuta esto primero para ver los límites actuales)
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'parent_profiles'
ORDER BY ordinal_position;

-- 2. Corregir límites de campos que probablemente causan el error
-- DNI en Perú puede tener 8 dígitos (adultos) o más (extranjeros con CE)
ALTER TABLE public.parent_profiles
  ALTER COLUMN dni TYPE VARCHAR(20);

ALTER TABLE public.parent_profiles
  ALTER COLUMN responsible_2_dni TYPE VARCHAR(20);

-- Teléfonos en Perú son 9 dígitos, pero con código país pueden ser más
ALTER TABLE public.parent_profiles
  ALTER COLUMN phone_1 TYPE VARCHAR(20);

ALTER TABLE public.parent_profiles
  ALTER COLUMN responsible_2_phone_1 TYPE VARCHAR(20);

-- Tipo de documento debe permitir valores como "DNI", "CE", "Pasaporte"
ALTER TABLE public.parent_profiles
  ALTER COLUMN document_type TYPE VARCHAR(20);

ALTER TABLE public.parent_profiles
  ALTER COLUMN responsible_2_document_type TYPE VARCHAR(20);

-- Dirección debe ser más amplia
ALTER TABLE public.parent_profiles
  ALTER COLUMN address TYPE TEXT;

ALTER TABLE public.parent_profiles
  ALTER COLUMN responsible_2_address TYPE TEXT;

-- Email debe ser suficientemente largo para correos completos
ALTER TABLE public.parent_profiles
  ALTER COLUMN responsible_2_email TYPE VARCHAR(255);

-- Nombres completos deben ser más amplios
ALTER TABLE public.parent_profiles
  ALTER COLUMN full_name TYPE VARCHAR(255);

ALTER TABLE public.parent_profiles
  ALTER COLUMN responsible_2_full_name TYPE VARCHAR(255);

-- 3. Verificar los cambios
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'parent_profiles'
ORDER BY ordinal_position;

-- ============================================
-- NOTA: Ejecuta este script en Supabase SQL Editor
-- ============================================
