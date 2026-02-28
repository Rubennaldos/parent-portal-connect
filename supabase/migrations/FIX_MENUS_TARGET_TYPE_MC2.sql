-- ============================================================
-- FIX: Corregir target_type de lunch_menus que no coincide 
--      con el target_type de su categoría
-- ============================================================
-- PROBLEMA: Algunos menús tienen target_type NULL o 'both', pero
-- su categoría tiene target_type = 'teachers'. Esto causa que
-- aparezcan como "Menús para Todos" en el calendario.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PASO 1: DIAGNÓSTICO — Ver menús con target_type incorrecto
-- ════════════════════════════════════════════════════════════

SELECT 
  lm.id AS menu_id,
  lm.date,
  lm.main_course,
  lm.target_type AS menu_target_type,
  lc.name AS category_name,
  lc.target_type AS category_target_type,
  s.name AS school_name
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
WHERE lm.target_type IS DISTINCT FROM lc.target_type
ORDER BY s.name, lm.date;

-- ════════════════════════════════════════════════════════════
-- PASO 2: CONTAR cuántos menús se van a corregir
-- ════════════════════════════════════════════════════════════

SELECT 
  s.name AS school_name,
  lc.name AS category_name,
  lc.target_type AS correcto,
  lm.target_type AS actual_en_menu,
  COUNT(*) AS cantidad
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
WHERE lm.target_type IS DISTINCT FROM lc.target_type
GROUP BY s.name, lc.name, lc.target_type, lm.target_type
ORDER BY s.name, lc.name;

-- ════════════════════════════════════════════════════════════
-- PASO 3: FIX — Actualizar target_type de menús para que
--         coincida con su categoría
-- ════════════════════════════════════════════════════════════

UPDATE lunch_menus lm
SET target_type = lc.target_type
FROM lunch_categories lc
WHERE lm.category_id = lc.id
  AND lm.target_type IS DISTINCT FROM lc.target_type;

-- ════════════════════════════════════════════════════════════
-- PASO 4: VERIFICAR que ya no hay discrepancias
-- ════════════════════════════════════════════════════════════

SELECT 
  COUNT(*) AS menus_sin_corregir
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
WHERE lm.target_type IS DISTINCT FROM lc.target_type;
-- Debe dar 0
