-- =====================================================
-- CORREGIR NOMBRES DE SEDES ST. GEORGE'S
-- Nombres oficiales:
--   • St. George's Miraflores
--   • St. George's Villa
--   • Little St. George's (CONFIRMAR CON USUARIO)
--
-- ⚠️ SEGURIDAD: Solo se cambia el campo "name" (texto visual).
--    NO se tocan: id (UUID), code (SGM/SGV/LSG), ni relaciones.
--    TODAS las relaciones en el sistema usan school_id (UUID).
-- =====================================================

-- 1️⃣ DIAGNÓSTICO: Ver estado actual de TODAS las sedes
SELECT 
  '📋 ESTADO ACTUAL' as paso,
  id,
  name,
  code
FROM schools
ORDER BY name;

-- 2️⃣ DIAGNÓSTICO: Buscar cualquier variación de George/Jorge
SELECT 
  '🔍 VARIACIONES ENCONTRADAS' as paso,
  id,
  name,
  code
FROM schools
WHERE name ILIKE '%george%' 
   OR name ILIKE '%jorge%'
ORDER BY name;

-- =====================================================
-- ⚠️ EJECUTAR PASO 3 SOLO DESPUÉS DE VERIFICAR PASO 1 Y 2
-- =====================================================

-- 3️⃣ CORREGIR: Actualizar a los nombres oficiales
UPDATE schools
SET name = CASE
  -- Little (cualquier variación con "little")
  WHEN name ILIKE '%little%george%' 
    THEN 'Little St. George''s'
  -- Miraflores (cualquier variación)
  WHEN (name ILIKE '%george%miraflores%' OR name ILIKE '%jorge%miraflores%') 
    THEN 'St. George''s Miraflores'
  -- Villa (cualquier variación)
  WHEN (name ILIKE '%george%villa%' OR name ILIKE '%jorge%villa%') 
    THEN 'St. George''s Villa'
  ELSE name
END
WHERE name ILIKE '%george%' OR name ILIKE '%jorge%';

-- 4️⃣ VERIFICACIÓN: Confirmar que se actualizó correctamente
SELECT 
  '✅ RESULTADO FINAL' as paso,
  id,
  name,
  code
FROM schools
WHERE name ILIKE '%george%' OR name ILIKE '%jorge%'
ORDER BY name;

-- 5️⃣ VERIFICACIÓN COMPLETA: Ver TODAS las sedes con nombre actualizado
SELECT 
  '🏫 TODAS LAS SEDES' as paso,
  id,
  name,
  code
FROM schools
ORDER BY name;
