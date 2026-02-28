-- =====================================================================
-- LIMPIAR AULAS Y GRADOS INACTIVOS (Fantasma)
-- Estos registros fueron "eliminados" con soft-delete (is_active=false)
-- pero siguen en la BD y causan errores de "duplicado" al recrear.
-- Ahora que el sistema usa hard-delete, limpiamos los existentes.
-- =====================================================================

-- ══════════════════════════════════════════════════════════════════════
-- PASO 1: DIAGNÓSTICO — Ver aulas inactivas (fantasma)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  '👻 AULAS FANTASMA (inactivas)' AS tipo,
  sc.id,
  sc.name AS aula,
  sl.name AS grado,
  s.name AS sede,
  sc.is_active
FROM school_classrooms sc
JOIN school_levels sl ON sc.level_id = sl.id
JOIN schools s ON sc.school_id = s.id
WHERE sc.is_active = false
ORDER BY s.name, sl.name, sc.name;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 2: DIAGNÓSTICO — Ver grados inactivos (fantasma)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  '👻 GRADOS FANTASMA (inactivos)' AS tipo,
  sl.id,
  sl.name AS grado,
  s.name AS sede,
  sl.is_active
FROM school_levels sl
JOIN schools s ON sl.school_id = s.id
WHERE sl.is_active = false
ORDER BY s.name, sl.name;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 3: DIAGNÓSTICO — ¿Hay estudiantes activos apuntando a estas aulas?
-- (Si hay, NO se pueden borrar — necesitan reasignarse primero)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  '⚠️ ESTUDIANTES EN AULAS FANTASMA' AS tipo,
  st.full_name,
  sc.name AS aula_fantasma,
  sl.name AS grado,
  s.name AS sede
FROM students st
JOIN school_classrooms sc ON st.classroom_id = sc.id
JOIN school_levels sl ON sc.level_id = sl.id
JOIN schools s ON sc.school_id = s.id
WHERE sc.is_active = false
  AND st.is_active = true
ORDER BY s.name, sl.name, sc.name;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 4: LIMPIEZA — Borrar aulas fantasma SIN estudiantes activos
-- ⚠️ EJECUTAR SOLO DESPUÉS DE VERIFICAR PASO 3
-- ══════════════════════════════════════════════════════════════════════
/*
DELETE FROM school_classrooms
WHERE is_active = false
  AND id NOT IN (
    SELECT DISTINCT classroom_id 
    FROM students 
    WHERE classroom_id IS NOT NULL 
      AND is_active = true
  );
*/

-- ══════════════════════════════════════════════════════════════════════
-- PASO 5: LIMPIEZA — Borrar grados fantasma SIN estudiantes activos y SIN aulas
-- ⚠️ EJECUTAR SOLO DESPUÉS DE VERIFICAR PASO 3 Y PASO 4
-- ══════════════════════════════════════════════════════════════════════
/*
DELETE FROM school_levels
WHERE is_active = false
  AND id NOT IN (
    SELECT DISTINCT level_id 
    FROM students 
    WHERE level_id IS NOT NULL 
      AND is_active = true
  )
  AND id NOT IN (
    SELECT DISTINCT level_id 
    FROM school_classrooms
  );
*/

-- ══════════════════════════════════════════════════════════════════════
-- PASO 6: VERIFICACIÓN FINAL
-- ══════════════════════════════════════════════════════════════════════
/*
SELECT 
  '✅ VERIFICACIÓN' AS paso,
  (SELECT COUNT(*) FROM school_classrooms WHERE is_active = false) AS aulas_fantasma_restantes,
  (SELECT COUNT(*) FROM school_levels WHERE is_active = false) AS grados_fantasma_restantes;
*/
