-- ============================================================
-- FIX: Desactivar duplicados SEGUROS (donde uno tiene saldo = 0)
-- SOLO toca los casos donde claramente uno es el real y el otro es vacío
-- Los casos con ambos saldos no-cero NO se tocan aquí
-- ============================================================
-- INSTRUCCIONES:
-- 1. Ejecuta el SELECT de verificación primero
-- 2. Si todo se ve bien, ejecuta el UPDATE
-- 3. Al final ejecuta el SELECT de verificación final
-- ============================================================

-- ────────────────────────────────────────
-- VERIFICACIÓN PREVIA: ver qué se va a desactivar
-- ────────────────────────────────────────
SELECT 
  id_a_desactivar,
  nombre,
  saldo_a_desactivar,
  id_a_conservar,
  saldo_a_conservar,
  sede
FROM (
  SELECT 
    s1.full_name AS nombre,
    sc.name AS sede,
    -- Conservar el que tiene saldo != 0, desactivar el de saldo = 0
    CASE 
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) != 0 THEN s1.id
      WHEN COALESCE(s2.balance, 0) = 0 AND COALESCE(s1.balance, 0) != 0 THEN s2.id
      -- Si ambos son 0, desactivar el más reciente (id_b, que tiene UUID mayor)
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) = 0 THEN s2.id
      ELSE NULL -- Ambos tienen saldo != 0: NO TOCAR (casos complejos)
    END AS id_a_desactivar,
    CASE 
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) != 0 THEN s1.balance
      WHEN COALESCE(s2.balance, 0) = 0 AND COALESCE(s1.balance, 0) != 0 THEN s2.balance
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) = 0 THEN s2.balance
      ELSE NULL
    END AS saldo_a_desactivar,
    CASE 
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) != 0 THEN s2.id
      WHEN COALESCE(s2.balance, 0) = 0 AND COALESCE(s1.balance, 0) != 0 THEN s1.id
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) = 0 THEN s1.id
      ELSE NULL
    END AS id_a_conservar,
    CASE 
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) != 0 THEN s2.balance
      WHEN COALESCE(s2.balance, 0) = 0 AND COALESCE(s1.balance, 0) != 0 THEN s1.balance
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) = 0 THEN s1.balance
      ELSE NULL
    END AS saldo_a_conservar
  FROM students s1
  JOIN students s2 
    ON LOWER(TRIM(s1.full_name)) = LOWER(TRIM(s2.full_name))
    AND s1.school_id = s2.school_id
    AND s1.id < s2.id
    AND s1.is_active = true
    AND s2.is_active = true
  LEFT JOIN schools sc ON sc.id = s1.school_id
  -- Solo los casos donde ambos tienen saldo en la misma dirección (no conflicto)
  WHERE NOT (COALESCE(s1.balance, 0) != 0 AND COALESCE(s2.balance, 0) != 0)
) sub
WHERE id_a_desactivar IS NOT NULL
ORDER BY nombre;

-- ────────────────────────────────────────
-- FIX: Desactivar los duplicados seguros
-- QUITAR el /* y */ para ejecutar
-- ────────────────────────────────────────
/*

WITH duplicados_seguros AS (
  SELECT 
    CASE 
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) != 0 THEN s1.id
      WHEN COALESCE(s2.balance, 0) = 0 AND COALESCE(s1.balance, 0) != 0 THEN s2.id
      WHEN COALESCE(s1.balance, 0) = 0 AND COALESCE(s2.balance, 0) = 0 THEN s2.id
      ELSE NULL
    END AS id_a_desactivar
  FROM students s1
  JOIN students s2 
    ON LOWER(TRIM(s1.full_name)) = LOWER(TRIM(s2.full_name))
    AND s1.school_id = s2.school_id
    AND s1.id < s2.id
    AND s1.is_active = true
    AND s2.is_active = true
  WHERE NOT (COALESCE(s1.balance, 0) != 0 AND COALESCE(s2.balance, 0) != 0)
)
UPDATE students
SET 
  is_active = false,
  full_name = full_name || ' [DUPLICADO]'
WHERE id IN (SELECT id_a_desactivar FROM duplicados_seguros WHERE id_a_desactivar IS NOT NULL);

*/

-- ────────────────────────────────────────
-- VERIFICACIÓN FINAL: confirmar que se eliminaron los duplicados seguros
-- ────────────────────────────────────────
/*
SELECT COUNT(*), LOWER(TRIM(full_name)) AS nombre, school_id
FROM students
WHERE is_active = true
GROUP BY LOWER(TRIM(full_name)), school_id
HAVING COUNT(*) > 1
ORDER BY nombre;
*/

-- ────────────────────────────────────────
-- PREVENCIÓN: agregar restricción única para que NO vuelva a pasar
-- Ejecutar AL FINAL, después de resolver TODOS los duplicados
-- ────────────────────────────────────────
/*
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_unique_name_school
ON students (LOWER(TRIM(full_name)), school_id)
WHERE is_active = true;
*/
