-- =====================================================
-- COPIAR Y PEGAR ESTE SQL EN SUPABASE SQL EDITOR
-- =====================================================

-- 1️⃣ Ver estado actual
SELECT 
  '📋 ANTES - Todas las escuelas' as paso,
  id,
  name,
  code
FROM schools
ORDER BY name;

-- 2️⃣ Actualizar "San Jorge" a "St George"
UPDATE schools
SET name = CASE
  WHEN name ILIKE '%san jorge%miraflores%' THEN 'St George Miraflores'
  WHEN name ILIKE '%san jorge%villa%' THEN 'St George Villa'
  WHEN name = 'San Jorge Miraflores' THEN 'St George Miraflores'
  WHEN name = 'San Jorge Villa' THEN 'St George Villa'
  WHEN name = 'San Jorge' THEN 'St George'
  ELSE name
END
WHERE name ILIKE '%san jorge%';

-- 3️⃣ Ver resultado
SELECT 
  '✅ DESPUÉS - Todas las escuelas' as paso,
  id,
  name,
  code
FROM schools
ORDER BY name;

-- 4️⃣ Verificar que no quede ningún "San Jorge"
SELECT 
  '🚨 VERIFICACIÓN FINAL' as paso,
  COUNT(*) as "¿Quedan San Jorge?",
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ Perfecto, todos corregidos'
    ELSE '⚠️ Aún quedan por corregir'
  END as estado
FROM schools
WHERE name ILIKE '%san jorge%';
