-- ============================================================
-- 1. BACKFILL: Rellenar user_id faltantes en parent_profiles
-- ============================================================
-- Problema: 1,536 registros sin user_id
-- Solución: buscar por email en profiles y asignar el id
UPDATE parent_profiles pp
SET user_id = p.id
FROM profiles p
WHERE LOWER(pp.email) = LOWER(p.email)
  AND pp.user_id IS NULL;

-- Verificar cuántos quedaron sin corregir (deberían ser ~6)
-- SELECT COUNT(*) FROM parent_profiles WHERE user_id IS NULL;

-- ============================================================
-- 2. NUEVA COLUMNA: is_temp_password en profiles
-- ============================================================
-- Marca si el usuario tiene una contraseña temporal asignada por admin
-- Cuando es TRUE, el sistema obliga a cambiarla al iniciar sesión
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_temp_password BOOLEAN DEFAULT FALSE;

-- Índice para que la consulta en login sea rápida
CREATE INDEX IF NOT EXISTS idx_profiles_is_temp_password
  ON profiles(id) WHERE is_temp_password = TRUE;

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
-- SELECT COUNT(*) AS sin_user_id FROM parent_profiles WHERE user_id IS NULL;
-- SELECT COUNT(*) AS con_temp_password FROM profiles WHERE is_temp_password = TRUE;
