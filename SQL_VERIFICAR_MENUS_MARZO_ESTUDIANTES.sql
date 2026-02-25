-- ============================================
-- 📅 VERIFICACIÓN: MENÚS DE MARZO PARA ESTUDIANTES
-- ============================================
-- Verifica qué sedes tienen menús completos para marzo
-- Específicamente para estudiantes (target_type = 'students' o 'both')
-- ============================================

-- ============================================
-- OPCIÓN 1: RESUMEN POR SEDE - MENÚS DE MARZO
-- ============================================

WITH dias_marzo AS (
  SELECT fecha::DATE AS fecha
  FROM generate_series(
    DATE '2026-03-01',
    DATE '2026-03-31',
    INTERVAL '1 day'
  ) AS fecha
  WHERE EXTRACT(DOW FROM fecha::DATE) BETWEEN 1 AND 5  -- Solo días laborables (lunes a viernes)
),
menus_por_sede AS (
  SELECT 
    s.code,
    s.name,
    COUNT(DISTINCT lm.date) AS dias_con_menu,
    COUNT(DISTINCT lc.id) AS categorias_estudiantes,
    STRING_AGG(DISTINCT lc.name, ', ' ORDER BY lc.name) AS tipos_menu
  FROM schools s
  INNER JOIN lunch_categories lc ON s.id = lc.school_id
  LEFT JOIN lunch_menus lm ON lc.id = lm.category_id 
    AND lm.date >= '2026-03-01' 
    AND lm.date <= '2026-03-31'
    AND lm.target_type IN ('students', 'both')
  WHERE lc.is_active = true
    AND lc.target_type IN ('students', 'both')
  GROUP BY s.id, s.code, s.name
),
dias_laborables_marzo AS (
  SELECT COUNT(*) AS total_dias
  FROM dias_marzo
)
SELECT 
  mps.code AS "Código",
  mps.name AS "Sede",
  mps.categorias_estudiantes AS "Categorías para Estudiantes",
  mps.dias_con_menu AS "Días con Menú en Marzo",
  dl.total_dias AS "Días Laborables en Marzo",
  CASE 
    WHEN mps.dias_con_menu = 0 THEN '❌ Sin menús'
    WHEN mps.dias_con_menu < dl.total_dias THEN CONCAT('⚠️ Incompleto (', dl.total_dias - mps.dias_con_menu, ' días faltantes)')
    ELSE '✅ Completo'
  END AS "Estado",
  ROUND((mps.dias_con_menu::NUMERIC / dl.total_dias::NUMERIC) * 100, 1) AS "% Completado",
  mps.tipos_menu AS "Tipos de Menú Disponibles"
FROM menus_por_sede mps
CROSS JOIN dias_laborables_marzo dl
ORDER BY mps.code;

-- ============================================
-- OPCIÓN 2: DETALLE DÍA POR DÍA - DÍAS FALTANTES
-- ============================================

WITH dias_marzo AS (
  SELECT fecha::DATE AS fecha
  FROM generate_series(
    DATE '2026-03-01',
    DATE '2026-03-31',
    INTERVAL '1 day'
  ) AS fecha
  WHERE EXTRACT(DOW FROM fecha::DATE) BETWEEN 1 AND 5  -- Solo días laborables
),
menus_existentes AS (
  SELECT DISTINCT
    s.code,
    s.name,
    lm.date
  FROM schools s
  INNER JOIN lunch_categories lc ON s.id = lc.school_id
  INNER JOIN lunch_menus lm ON lc.id = lm.category_id
  WHERE lc.is_active = true
    AND lc.target_type IN ('students', 'both')
    AND lm.target_type IN ('students', 'both')
    AND lm.date >= '2026-03-01'
    AND lm.date <= '2026-03-31'
)
SELECT 
  s.code AS "Código",
  s.name AS "Sede",
  dm.fecha AS "Día Faltante",
  TO_CHAR(dm.fecha, 'Day DD "de" Month') AS "Fecha Formato",
  CASE EXTRACT(DOW FROM dm.fecha)
    WHEN 1 THEN 'Lunes'
    WHEN 2 THEN 'Martes'
    WHEN 3 THEN 'Miércoles'
    WHEN 4 THEN 'Jueves'
    WHEN 5 THEN 'Viernes'
  END AS "Día Semana"
FROM schools s
CROSS JOIN dias_marzo dm
LEFT JOIN menus_existentes me ON s.code = me.code AND dm.fecha = me.date
WHERE me.date IS NULL
  AND EXISTS (
    SELECT 1 FROM lunch_categories lc 
    WHERE lc.school_id = s.id 
    AND lc.is_active = true 
    AND lc.target_type IN ('students', 'both')
  )
ORDER BY s.code, dm.fecha;

-- ============================================
-- OPCIÓN 3: RESUMEN EJECUTIVO SIMPLE
-- ============================================

SELECT 
  s.code AS "Sede",
  s.name AS "Nombre",
  COUNT(DISTINCT CASE 
    WHEN lm.date >= '2026-03-01' 
    AND lm.date <= '2026-03-31'
    AND lm.target_type IN ('students', 'both')
    THEN lm.date 
  END) AS "Días con Menú en Marzo",
  COUNT(DISTINCT lc.id) AS "Categorías para Estudiantes",
  CASE 
    WHEN COUNT(DISTINCT CASE 
      WHEN lm.date >= '2026-03-01' 
      AND lm.date <= '2026-03-31'
      AND lm.target_type IN ('students', 'both')
      THEN lm.date 
    END) = 0 THEN '❌ Sin menús programados'
    WHEN COUNT(DISTINCT CASE 
      WHEN lm.date >= '2026-03-01' 
      AND lm.date <= '2026-03-31'
      AND lm.target_type IN ('students', 'both')
      THEN lm.date 
    END) >= 20 THEN '✅ Bien programado'
    ELSE '⚠️ Faltan días'
  END AS "Estado"
FROM schools s
LEFT JOIN lunch_categories lc ON s.id = lc.school_id 
  AND lc.is_active = true 
  AND lc.target_type IN ('students', 'both')
LEFT JOIN lunch_menus lm ON lc.id = lm.category_id
WHERE EXISTS (
  SELECT 1 FROM lunch_categories lc2 
  WHERE lc2.school_id = s.id 
  AND lc2.is_active = true 
  AND lc2.target_type IN ('students', 'both')
)
GROUP BY s.id, s.code, s.name
ORDER BY s.code;
