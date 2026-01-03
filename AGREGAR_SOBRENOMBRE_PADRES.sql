-- =====================================================
-- AGREGAR COLUMNA NICKNAME A PARENT_PROFILES
-- =====================================================
-- Este script agrega la columna 'nickname' (sobrenombre)
-- a la tabla parent_profiles para permitir apodos como
-- "Papá de Juanito", "Mamá de Sofía", etc.
-- =====================================================

-- 1. Agregar columna nickname
ALTER TABLE parent_profiles
ADD COLUMN IF NOT EXISTS nickname TEXT;

-- 2. Verificar la columna agregada
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'parent_profiles'
AND column_name = 'nickname';

-- ✅ LISTO: Ahora los padres pueden tener sobrenombres amigables

