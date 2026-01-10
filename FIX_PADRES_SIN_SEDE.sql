-- =========================================
-- VERIFICAR Y ARREGLAR PADRES SIN SEDE
-- =========================================

-- 1. VERIFICAR: ¿Cuántos padres NO tienen sede asignada?
SELECT 
  pp.user_id,
  p.email,
  pp.full_name,
  pp.school_id,
  CASE 
    WHEN pp.school_id IS NULL THEN '❌ SIN SEDE'
    ELSE '✅ CON SEDE'
  END as estado
FROM parent_profiles pp
LEFT JOIN profiles p ON p.id = pp.user_id
WHERE pp.school_id IS NULL
ORDER BY pp.full_name;

-- 2. MOSTRAR TODOS LOS PADRES CON SU SEDE
SELECT 
  pp.user_id,
  p.email,
  pp.full_name,
  pp.school_id,
  s.name as school_name,
  s.code as school_code
FROM parent_profiles pp
LEFT JOIN profiles p ON p.id = pp.user_id
LEFT JOIN schools s ON s.id = pp.school_id
ORDER BY pp.full_name;

-- 3. CONTAR PADRES POR SEDE
SELECT 
  s.name as sede,
  s.code,
  COUNT(pp.user_id) as total_padres
FROM schools s
LEFT JOIN parent_profiles pp ON pp.school_id = s.id
GROUP BY s.id, s.name, s.code
ORDER BY total_padres DESC;

-- =========================================
-- ARREGLAR: Asignar sede correcta a padres
-- =========================================

-- Opción A: Si sabes qué padre va a qué sede
-- EJEMPLO: Asignar albertonaldos@gmail.com a Nordic
/*
UPDATE parent_profiles
SET school_id = (SELECT id FROM schools WHERE code = 'NORDIC' LIMIT 1)
WHERE user_id = (SELECT id FROM profiles WHERE email = 'albertonaldos@gmail.com');
*/

-- Opción B: Si TODOS los padres sin sede deben ir al mismo colegio
-- EJEMPLO: Asignar todos a Nordic
/*
UPDATE parent_profiles
SET school_id = (SELECT id FROM schools WHERE code = 'NORDIC' LIMIT 1)
WHERE school_id IS NULL;
*/

-- Opción C: Asignar según el primer estudiante que tienen
-- (Usa la sede del primer hijo registrado)
/*
WITH student_schools AS (
  SELECT DISTINCT ON (sr.parent_id)
    sr.parent_id,
    s.school_id
  FROM student_relationships sr
  INNER JOIN students s ON s.id = sr.student_id
  WHERE sr.parent_id IS NOT NULL
  ORDER BY sr.parent_id, sr.created_at ASC
)
UPDATE parent_profiles pp
SET school_id = ss.school_id
FROM student_schools ss
WHERE pp.user_id = ss.parent_id
  AND pp.school_id IS NULL;
*/

-- =========================================
-- PREVENIR QUE VUELVA A PASAR
-- =========================================

-- Agregar constraint para que school_id sea obligatorio
-- (Solo si estás seguro de que TODOS los padres tienen sede)
/*
ALTER TABLE parent_profiles
ALTER COLUMN school_id SET NOT NULL;
*/

-- Alternativa: Agregar trigger que valide antes de crear un padre
CREATE OR REPLACE FUNCTION check_parent_has_school()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.school_id IS NULL AND NEW.onboarding_completed = true THEN
    RAISE EXCEPTION 'No se puede completar el onboarding sin asignar una sede';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_parent_school ON parent_profiles;
CREATE TRIGGER validate_parent_school
  BEFORE INSERT OR UPDATE ON parent_profiles
  FOR EACH ROW
  EXECUTE FUNCTION check_parent_has_school();

-- =========================================
-- VERIFICAR QUE TODO ESTÉ BIEN
-- =========================================

-- Ver padres sin sede (debería ser 0 después de arreglar)
SELECT COUNT(*) as padres_sin_sede
FROM parent_profiles
WHERE school_id IS NULL;

-- Ver distribución final
SELECT 
  COALESCE(s.name, 'SIN SEDE') as sede,
  COUNT(pp.user_id) as total_padres
FROM parent_profiles pp
LEFT JOIN schools s ON s.id = pp.school_id
GROUP BY s.name
ORDER BY total_padres DESC;


