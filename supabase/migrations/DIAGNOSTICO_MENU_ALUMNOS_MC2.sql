-- =====================================================================
-- DIAGNÓSTICO: Categorías "Menú Alumnos Opción 1" y "Menú Alumno Opción 2"
-- en Maristas Champagnat 2 (MC2)
-- Objetivo: Ver si tienen menús, pedidos y pagos antes de decidir qué hacer
-- =====================================================================

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA 1: Encontrar las categorías y su info
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  lc.id,
  lc.name,
  lc.target_type,
  lc.price,
  lc.is_active,
  lc.display_order,
  s.name AS sede
FROM lunch_categories lc
JOIN schools s ON lc.school_id = s.id
WHERE (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
ORDER BY s.name, lc.name;

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA 2: Menús creados con esas categorías (TODOS los meses)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  lm.id AS menu_id,
  lm.date,
  lm.starter AS entrada,
  lm.main_course AS segundo,
  lm.beverage AS bebida,
  lm.dessert AS postre,
  lm.target_type AS menu_target,
  lc.name AS categoria,
  s.name AS sede
FROM lunch_menus lm
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
WHERE (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
ORDER BY s.name, lm.date, lc.name;

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA 3: Pedidos (lunch_orders) de esas categorías
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  lo.id AS order_id,
  lo.order_date,
  lo.status AS estado_pedido,
  lo.quantity,
  lo.final_price,
  lo.payment_method,
  COALESCE(st.full_name, tp.full_name, lo.manual_name) AS cliente,
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'Alumno'
    WHEN lo.teacher_id IS NOT NULL THEN 'Profesor'
    ELSE 'Manual'
  END AS tipo_cliente,
  lc.name AS categoria,
  lm.date AS fecha_menu,
  s.name AS sede
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
ORDER BY s.name, lo.order_date, cliente;

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA 4: Estado de PAGO de cada pedido (con transacciones)
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  lo.id AS order_id,
  lo.order_date,
  COALESCE(st.full_name, tp.full_name, lo.manual_name) AS cliente,
  lc.name AS categoria,
  lo.status AS estado_pedido,
  t.payment_status AS estado_pago,
  t.amount AS monto,
  t.payment_method AS metodo_pago,
  t.ticket_code AS ticket,
  CASE
    WHEN t.payment_status = 'paid'    THEN '✅ PAGADO'
    WHEN t.payment_status = 'pending' THEN '⏳ PENDIENTE'
    ELSE '❌ SIN TRANSACCIÓN'
  END AS resumen_pago,
  s.name AS sede
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
JOIN lunch_categories lc ON lm.category_id = lc.id
JOIN schools s ON lm.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
LEFT JOIN transactions t ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
ORDER BY s.name, lo.order_date, cliente;

-- ══════════════════════════════════════════════════════════════════════
-- CONSULTA 5: RESUMEN TOTAL por categoría
-- ══════════════════════════════════════════════════════════════════════
SELECT 
  lc.name AS categoria,
  s.name AS sede,
  lc.is_active AS activa,
  lc.price AS precio,
  COUNT(DISTINCT lm.id) AS menus_creados,
  COUNT(DISTINCT lo.id) AS total_pedidos,
  COUNT(DISTINCT CASE WHEN lo.status = 'cancelled' OR lo.is_cancelled = true THEN lo.id END) AS cancelados,
  COUNT(DISTINCT CASE WHEN t.payment_status = 'paid' THEN lo.id END) AS pagados,
  COUNT(DISTINCT CASE WHEN t.payment_status = 'pending' THEN lo.id END) AS pendientes,
  COUNT(DISTINCT CASE WHEN t.id IS NULL AND lo.id IS NOT NULL AND lo.status != 'cancelled' THEN lo.id END) AS sin_transaccion,
  COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN ABS(t.amount) ELSE 0 END), 0) AS monto_pagado_S,
  COALESCE(SUM(CASE WHEN t.payment_status = 'pending' THEN ABS(t.amount) ELSE 0 END), 0) AS monto_pendiente_S
FROM lunch_categories lc
JOIN schools s ON lc.school_id = s.id
LEFT JOIN lunch_menus lm ON lm.category_id = lc.id
LEFT JOIN lunch_orders lo ON lo.menu_id = lm.id
LEFT JOIN transactions t ON lo.id::text = t.metadata->>'lunch_order_id'
WHERE (lc.name ILIKE '%Menú Alumnos%' OR lc.name ILIKE '%Menú Alumno%')
GROUP BY lc.name, s.name, lc.is_active, lc.price
ORDER BY s.name, lc.name;
