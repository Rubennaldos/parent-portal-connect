-- =====================================================
-- VERIFICAR Y CORREGIR TODAS LAS REFERENCIAS A "SAN JORGE"
-- =====================================================

-- 1️⃣ PRIMERO: Ver el estado actual de las escuelas
SELECT 
  '📋 ESTADO ACTUAL DE ESCUELAS' as paso,
  id,
  name,
  code,
  created_at
FROM schools
WHERE name ILIKE '%jorge%' OR name ILIKE '%george%'
ORDER BY name;

-- 2️⃣ VERIFICAR: ¿Dónde aparece "San Jorge"?

-- En la tabla schools
SELECT 
  '🔍 EN TABLA SCHOOLS' as tipo,
  COUNT(*) as cantidad,
  STRING_AGG(DISTINCT name, ', ') as nombres_encontrados
FROM schools
WHERE name ILIKE '%san jorge%';

-- En transacciones (descripción)
SELECT 
  '🔍 EN TRANSACCIONES (descripción)' as tipo,
  COUNT(*) as cantidad
FROM transactions
WHERE description ILIKE '%san jorge%';

-- En transacciones (metadata)
SELECT 
  '🔍 EN TRANSACCIONES (metadata)' as tipo,
  COUNT(*) as cantidad
FROM transactions
WHERE metadata::text ILIKE '%san jorge%';

-- 3️⃣ CORREGIR: Cambiar "San Jorge" a "St George"

-- Actualizar tabla schools
UPDATE schools
SET name = CASE
  WHEN name ILIKE '%san jorge miraflores%' THEN 'St George Miraflores'
  WHEN name ILIKE '%san jorge villa%' THEN 'St George Villa'
  WHEN name ILIKE '%san jorge%' AND name ILIKE '%miraflores%' THEN 'St George Miraflores'
  WHEN name ILIKE '%san jorge%' AND name ILIKE '%villa%' THEN 'St George Villa'
  ELSE name
END
WHERE name ILIKE '%san jorge%';

-- Verificar cuántas filas se actualizaron
SELECT 
  '✅ ESCUELAS ACTUALIZADAS' as resultado,
  COUNT(*) as cantidad_actualizada
FROM schools
WHERE name ILIKE '%st george%';

-- 4️⃣ VERIFICAR RESULTADO FINAL
SELECT 
  '🎯 RESULTADO FINAL - TODAS LAS ESCUELAS' as paso,
  id,
  name,
  code,
  created_at
FROM schools
ORDER BY name;

-- Verificar que NO quede ninguna referencia a "San Jorge"
SELECT 
  '🚨 VERIFICAR: ¿Quedó algún "San Jorge"?' as verificacion,
  COUNT(*) as cantidad_restante
FROM schools
WHERE name ILIKE '%san jorge%';
