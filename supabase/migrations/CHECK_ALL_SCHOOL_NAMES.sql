-- =====================================================
-- VERIFICAR NOMBRES DE TODAS LAS SEDES
-- =====================================================

-- 1. Ver todas las sedes con sus nombres actuales
SELECT 
  id,
  name,
  code,
  address,
  created_at
FROM schools
ORDER BY name;

-- 2. Buscar específicamente sedes con "jorge" o "george"
SELECT 
  '🔍 SEDES CON JORGE/GEORGE' as info,
  id,
  name,
  code
FROM schools
WHERE name ILIKE '%jorge%' OR name ILIKE '%george%';

-- 3. Ver cuántos registros hacen referencia a cada sede
SELECT 
  s.name as sede_nombre,
  s.code as sede_codigo,
  COUNT(DISTINCT p.id) as cantidad_padres,
  COUNT(DISTINCT st.id) as cantidad_estudiantes,
  COUNT(DISTINCT tp.id) as cantidad_profesores
FROM schools s
LEFT JOIN parent_profiles p ON p.school_id = s.id
LEFT JOIN students st ON st.school_id = s.id
LEFT JOIN teacher_profiles tp ON tp.school_id_1 = s.id OR tp.school_id_2 = s.id
GROUP BY s.id, s.name, s.code
ORDER BY s.name;

-- 4. Si necesitas cambiar el nombre de una sede, usa este UPDATE
-- (Descomenta y ajusta según sea necesario)
/*
UPDATE schools
SET name = 'St George Miraflores'
WHERE name ILIKE '%san jorge%' OR name ILIKE '%san_jorge%';
*/
