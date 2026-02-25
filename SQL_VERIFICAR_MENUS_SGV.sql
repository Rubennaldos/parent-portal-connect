-- ============================================
-- 🔍 VERIFICAR MENÚS EN "Menu especial" de SGV
-- ============================================
-- Ver si hay múltiples menús en la misma categoría para la misma fecha

SELECT 
    lm.date AS fecha,
    TO_CHAR(lm.date, 'Day') AS dia_semana,
    lc.name AS categoria,
    lc.target_type,
    lm.main_course AS segundo,
    lm.starter AS entrada,
    lm.beverage AS bebida,
    lm.dessert AS postre,
    lm.id AS menu_id,
    COUNT(*) OVER (PARTITION BY lm.date, lc.id) AS cantidad_menus_misma_categoria
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools sc ON lc.school_id = sc.id
WHERE sc.code = 'SGV'
  AND lc.name = 'Menu especial'  -- O 'Menú especial' si tiene tilde
  AND lm.date >= CURRENT_DATE
  AND lm.date <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY lm.date, lc.name, lm.main_course;


-- ============================================
-- 🔍 VER TODAS LAS CATEGORÍAS Y SUS MENÚS (SGV)
-- ============================================
-- Ver cuántos menús hay por categoría por fecha

SELECT 
    lm.date AS fecha,
    TO_CHAR(lm.date, 'Day') AS dia_semana,
    lc.name AS categoria,
    COUNT(*) AS cantidad_menus,
    STRING_AGG(lm.main_course, ' | ') AS segundos_disponibles
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools sc ON lc.school_id = sc.id
WHERE sc.code = 'SGV'
  AND lm.date >= CURRENT_DATE
  AND lm.date <= CURRENT_DATE + INTERVAL '30 days'
GROUP BY lm.date, lc.name
HAVING COUNT(*) > 1  -- Solo mostrar categorías con múltiples menús
ORDER BY lm.date, lc.name;


-- ============================================
-- 🔍 VERIFICAR SI ALUMNOS DEBERÍAN VER CATEGORÍAS EN SGV
-- ============================================
-- Respuesta: NO deberían ver ninguna (no hay categorías students)

SELECT 
    'SGV' AS sede,
    COUNT(*) FILTER (WHERE target_type = 'students') AS categorias_para_alumnos,
    COUNT(*) FILTER (WHERE target_type = 'teachers') AS categorias_para_profesores,
    COUNT(*) FILTER (WHERE target_type = 'both') AS categorias_para_ambos
FROM lunch_categories lc
JOIN schools sc ON lc.school_id = sc.id
WHERE sc.code = 'SGV'
  AND lc.is_active = true;
