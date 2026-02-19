-- ============================================================
-- DIAGNÓSTICO: Pedidos afectados por categoría eliminada/inactiva
-- Ejecutar en Supabase SQL Editor para ver el impacto en Champagne 2
-- ============================================================

-- 1. Ver las categorías INACTIVAS actuales y cuántos pedidos futuros tienen
SELECT 
  lc.id,
  lc.name AS categoria,
  lc.is_active,
  s.name AS sede,
  COUNT(lo.id) AS pedidos_futuros_activos
FROM lunch_categories lc
JOIN schools s ON s.id = lc.school_id
LEFT JOIN lunch_orders lo ON lo.category_id = lc.id 
  AND lo.order_date >= CURRENT_DATE 
  AND lo.is_cancelled = false
WHERE lc.is_active = false
GROUP BY lc.id, lc.name, lc.is_active, s.name
ORDER BY pedidos_futuros_activos DESC, s.name;

-- 2. Pedidos cuya categoría ya no existe (FK huérfana - categoría eliminada)
SELECT 
  lo.id AS orden_id,
  lo.order_date,
  lo.category_id AS categoria_id_huerfana,
  lo.status,
  lo.is_cancelled,
  lo.final_price,
  s.name AS sede,
  COALESCE(st.full_name, tp.full_name, 'Desconocido') AS persona
FROM lunch_orders lo
JOIN schools s ON s.id = lo.school_id
LEFT JOIN students st ON st.id = lo.student_id
LEFT JOIN teacher_profiles tp ON tp.id = lo.teacher_id
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE lo.category_id IS NOT NULL 
  AND lc.id IS NULL  -- la categoría fue eliminada (huérfana)
  AND lo.order_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY lo.order_date DESC;

-- 3. Pedidos de hoy con categoría inactiva (categoría desactivada pero no eliminada)
SELECT 
  lo.id AS orden_id,
  lo.order_date,
  lc.name AS categoria_inactiva,
  lc.is_active,
  lo.status,
  lo.is_cancelled,
  lo.final_price,
  s.name AS sede,
  COALESCE(st.full_name, tp.full_name, 'Desconocido') AS persona
FROM lunch_orders lo
JOIN lunch_categories lc ON lc.id = lo.category_id
JOIN schools s ON s.id = lo.school_id
LEFT JOIN students st ON st.id = lo.student_id
LEFT JOIN teacher_profiles tp ON tp.id = lo.teacher_id
WHERE lc.is_active = false 
  AND lo.order_date >= CURRENT_DATE
  AND lo.is_cancelled = false
ORDER BY lo.order_date, s.name;

-- 4. Menús que quedaron sin categoría (categoría fue eliminada → SET NULL)
SELECT 
  lm.id AS menu_id,
  lm.date,
  lm.main_course,
  s.name AS sede
FROM lunch_menus lm
JOIN schools s ON s.id = lm.school_id
WHERE lm.category_id IS NULL 
  AND lm.date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY lm.date DESC;

-- 5. Resumen general por sede: categorías inactivas con pedidos futuros
SELECT 
  s.name AS sede,
  lc.name AS categoria,
  lc.is_active,
  COUNT(lo.id) AS total_pedidos_futuros,
  SUM(lo.final_price) AS monto_total
FROM lunch_categories lc
JOIN schools s ON s.id = lc.school_id
LEFT JOIN lunch_orders lo ON lo.category_id = lc.id 
  AND lo.order_date >= CURRENT_DATE 
  AND lo.is_cancelled = false
WHERE lc.is_active = false
GROUP BY s.name, lc.name, lc.is_active
ORDER BY s.name, total_pedidos_futuros DESC;
