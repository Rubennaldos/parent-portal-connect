-- =====================================================
-- DIAGNÓSTICO: Categorías "Almuerzo Light de Pescado" y "Almuerzo Light de Pollo"
-- Verificar si tienen pedidos desde el 9 de marzo en adelante
-- =====================================================

-- 1. Encontrar las categorías por nombre
SELECT 
  id,
  name,
  school_id,
  is_active,
  target_type,
  price
FROM lunch_categories
WHERE name ILIKE '%Light de Pescado%'
   OR name ILIKE '%Light de Pollo%'
ORDER BY name;

-- =====================================================
-- 2. Ver los MENÚS creados con esas categorías desde el 9 de marzo
-- =====================================================
SELECT 
  lm.id AS menu_id,
  lm.date,
  lm.main_course,
  lc.name AS categoria,
  lc.id AS category_id,
  s.name AS sede
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
LEFT JOIN schools s ON lm.school_id = s.id
WHERE (lc.name ILIKE '%Light de Pescado%' OR lc.name ILIKE '%Light de Pollo%')
  AND lm.date >= '2026-03-09'
ORDER BY lm.date, lc.name;

-- =====================================================
-- 3. Ver los PEDIDOS (lunch_orders) que ya tienen esos menús desde el 9 de marzo
-- =====================================================
SELECT 
  lo.id AS order_id,
  lo.order_date,
  lo.status,
  lo.payment_method,
  lc.name AS categoria,
  COALESCE(st.full_name, tp.full_name, lo.manual_name) AS cliente,
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'Alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'Profesor'
    ELSE 'Manual'
  END AS tipo_cliente
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE (lc.name ILIKE '%Light de Pescado%' OR lc.name ILIKE '%Light de Pollo%')
  AND lo.order_date >= '2026-03-09'
  AND lo.is_cancelled = false
ORDER BY lo.order_date, lc.name;

-- =====================================================
-- 4. RESUMEN: Conteo total de pedidos por categoría
-- =====================================================
SELECT 
  lc.name AS categoria,
  COUNT(lo.id) AS total_pedidos,
  MIN(lo.order_date) AS primer_pedido,
  MAX(lo.order_date) AS ultimo_pedido
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
WHERE (lc.name ILIKE '%Light de Pescado%' OR lc.name ILIKE '%Light de Pollo%')
  AND lo.order_date >= '2026-03-09'
  AND lo.is_cancelled = false
GROUP BY lc.name
ORDER BY lc.name;
