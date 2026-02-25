-- ============================================
-- 📊 REPORTE DE MENÚS POR SEDE - LIMA CAFÉ 28
-- ============================================
-- Este SQL muestra qué sedes tienen menú, cuántos y qué tienen
-- Fecha: 2026-02-25
-- ============================================

-- ============================================
-- OPCIÓN 1: RESUMEN EJECUTIVO (RECOMENDADO)
-- ============================================
-- Muestra: Sede | Categorías | Menús Totales | Menús Futuros | Tipos de Menú
-- ============================================

WITH resumen_sedes AS (
  SELECT 
    s.code,
    s.name,
    COUNT(DISTINCT lc.id) AS categorias,
    COUNT(DISTINCT lm.id) AS menus_totales,
    COUNT(DISTINCT CASE WHEN lm.date >= CURRENT_DATE THEN lm.id END) AS menus_futuros,
    STRING_AGG(DISTINCT lc.name, ' • ') AS tipos_menu
  FROM schools s
  LEFT JOIN lunch_categories lc ON s.id = lc.school_id AND lc.is_active = true
  LEFT JOIN lunch_menus lm ON s.id = lm.school_id
  GROUP BY s.id, s.code, s.name
)
SELECT 
  code AS "Código",
  name AS "Sede",
  categorias AS "Categorías",
  menus_totales AS "Menús Totales",
  menus_futuros AS "Menús Futuros",
  tipos_menu AS "Tipos de Menú Disponibles"
FROM resumen_sedes
ORDER BY code;

-- ============================================
-- OPCIÓN 2: DETALLE COMPLETO POR CATEGORÍA
-- ============================================
-- Muestra: Sede | Categoría | Para Quién | Precio | Cantidad de Menús | Ejemplos
-- ============================================

SELECT 
  s.code AS "Sede",
  s.name AS "Nombre Sede",
  lc.name AS "Categoría de Menú",
  CASE 
    WHEN lc.target_type = 'students' THEN 'Estudiantes'
    WHEN lc.target_type = 'teachers' THEN 'Profesores'
    WHEN lc.target_type = 'both' THEN 'Ambos'
    ELSE lc.target_type
  END AS "Para Quién",
  COALESCE(lc.price, 0) AS "Precio (S/)",
  CASE WHEN lc.is_active THEN '✅ Activa' ELSE '❌ Inactiva' END AS "Estado",
  COUNT(lm.id) AS "Cantidad de Menús",
  (
    SELECT STRING_AGG(
      CONCAT(
        TO_CHAR(lm2.date, 'DD/MM/YYYY'), 
        ' - ', 
        COALESCE(lm2.main_course, 'Sin segundo')
      ), 
      ' | '
      ORDER BY lm2.date DESC
    )
    FROM (
      SELECT date, main_course
      FROM lunch_menus
      WHERE category_id = lc.id
      ORDER BY date DESC
      LIMIT 5
    ) lm2
  ) AS "Ejemplos de Menús"
FROM schools s
LEFT JOIN lunch_categories lc ON s.id = lc.school_id
LEFT JOIN lunch_menus lm ON lc.id = lm.category_id
GROUP BY s.id, s.code, s.name, lc.id, lc.name, lc.target_type, lc.price, lc.is_active, lc.display_order
ORDER BY s.code, lc.display_order, lc.name;

-- ============================================
-- OPCIÓN 3: SOLO SEDES CON MENÚS ACTIVOS
-- ============================================
-- Muestra solo las sedes que tienen categorías activas
-- ============================================

SELECT 
  s.code AS "Código",
  s.name AS "Sede",
  COUNT(DISTINCT lc.id) AS "Categorías Activas",
  STRING_AGG(DISTINCT lc.name, ', ') AS "Menús Disponibles"
FROM schools s
INNER JOIN lunch_categories lc ON s.id = lc.school_id
WHERE lc.is_active = true
GROUP BY s.id, s.code, s.name
ORDER BY s.code;

-- ============================================
-- OPCIÓN 4: MENÚS DE LOS PRÓXIMOS 30 DÍAS
-- ============================================
-- Muestra los menús programados para las próximas 4 semanas
-- ============================================

SELECT 
  s.code AS "Sede",
  lc.name AS "Categoría",
  lm.date AS "Fecha",
  lm.starter AS "Entrada",
  lm.main_course AS "Segundo",
  lm.beverage AS "Bebida",
  lm.dessert AS "Postre",
  CASE 
    WHEN lm.target_type = 'students' THEN '👨‍🎓 Estudiantes'
    WHEN lm.target_type = 'teachers' THEN '👩‍🏫 Profesores'
    WHEN lm.target_type = 'both' THEN '👥 Ambos'
    ELSE lm.target_type
  END AS "Para"
FROM schools s
INNER JOIN lunch_categories lc ON s.id = lc.school_id
INNER JOIN lunch_menus lm ON lc.id = lm.category_id
WHERE lm.date >= CURRENT_DATE 
  AND lm.date <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY s.code, lm.date, lc.name;
