-- ============================================================
-- DIAGNÓSTICO: Estudiantes duplicados en el POS
-- ============================================================
-- INSTRUCCIONES:
-- 1. Ejecuta primero el PASO 1 para ver cuántos duplicados hay
-- 2. Revisa la lista antes de hacer cualquier cambio
-- 3. Solo después ejecuta el PASO 2 (fix)
-- ============================================================

-- ============================================================
-- PASO 1: VER todos los estudiantes duplicados
-- (mismo nombre + misma sede + ambos activos)
-- ============================================================
SELECT 
  s1.id            AS id_a,
  s1.full_name     AS nombre,
  s1.grade         AS grado_a,
  s1.section       AS seccion_a,
  s1.balance       AS saldo_a,
  s1.free_account  AS cuenta_libre_a,
  s2.id            AS id_b,
  s2.grade         AS grado_b,
  s2.section       AS seccion_b,
  s2.balance       AS saldo_b,
  s2.free_account  AS cuenta_libre_b,
  sc.name          AS sede
FROM students s1
JOIN students s2 
  ON LOWER(TRIM(s1.full_name)) = LOWER(TRIM(s2.full_name))
  AND s1.school_id = s2.school_id
  AND s1.id < s2.id          -- evitar duplicar filas en el resultado
  AND s1.is_active = true
  AND s2.is_active = true
LEFT JOIN schools sc ON sc.id = s1.school_id
ORDER BY s1.full_name;

-- ============================================================
-- PASO 2 (SOLO EJECUTAR DESPUÉS DE REVISAR EL PASO 1):
-- Desactivar el duplicado que NO tiene saldo
-- Se queda activo el que tiene el mayor saldo
-- ============================================================

/*  ← QUITAR este comentario para ejecutar el PASO 2

WITH duplicados AS (
  SELECT 
    s1.id AS id_a,
    s1.balance AS saldo_a,
    s2.id AS id_b,
    s2.balance AS saldo_b,
    -- El que tiene menos saldo es el duplicado a desactivar
    CASE 
      WHEN COALESCE(s1.balance, 0) >= COALESCE(s2.balance, 0) 
      THEN s2.id  -- desactivar s2
      ELSE s1.id  -- desactivar s1
    END AS id_a_desactivar
  FROM students s1
  JOIN students s2 
    ON LOWER(TRIM(s1.full_name)) = LOWER(TRIM(s2.full_name))
    AND s1.school_id = s2.school_id
    AND s1.id < s2.id
    AND s1.is_active = true
    AND s2.is_active = true
)
UPDATE students
SET 
  is_active = false,
  full_name = full_name || ' [DUPLICADO]'   -- marcar para identificarlo fácil
WHERE id IN (SELECT id_a_desactivar FROM duplicados);

*/

-- ============================================================
-- VERIFICACIÓN FINAL: Confirmar que ya no hay duplicados
-- ============================================================
/*
SELECT COUNT(*), LOWER(TRIM(full_name)) AS nombre, school_id
FROM students
WHERE is_active = true
GROUP BY LOWER(TRIM(full_name)), school_id
HAVING COUNT(*) > 1
ORDER BY nombre;
*/
