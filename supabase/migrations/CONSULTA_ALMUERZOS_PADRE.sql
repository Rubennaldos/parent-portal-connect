-- =========================================================
-- CONSULTA: Almuerzos pedidos por un padre específico
-- =========================================================
-- Email: staysse_17@yahho.es
-- UID: a00af258-ff8b-4f32-8f79-c88dbc0d4d2d
-- =========================================================

-- PASO 1: Verificar que el usuario existe
SELECT 
  id,
  email,
  created_at,
  last_sign_in_at
FROM auth.users
WHERE email = 'staysse_17@yahho.es'
   OR id = 'a00af258-ff8b-4f32-8f79-c88dbc0d4d2d';

-- PASO 2: Ver todos los estudiantes asociados a este padre
SELECT 
  s.id AS student_id,
  s.full_name AS nombre_estudiante,
  s.grade AS grado,
  s.section AS seccion,
  s.is_active AS activo,
  s.is_temporary AS temporal,
  sch.name AS colegio,
  sch.code AS codigo_colegio
FROM students s
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.parent_id = 'a00af258-ff8b-4f32-8f79-c88dbc0d4d2d'
ORDER BY s.full_name;

-- PASO 3: Ver TODOS los pedidos de almuerzo de este padre (todos sus hijos)
SELECT 
  lo.id AS pedido_id,
  lo.order_date AS fecha_pedido,
  lo.status AS estado,
  lo.is_cancelled AS cancelado,
  lo.created_at AS fecha_creacion,
  lo.delivered_at AS fecha_entrega,
  lo.cancelled_at AS fecha_cancelacion,
  lo.postponed_at AS fecha_postergacion,
  lo.parent_notes AS observaciones_padre,
  lo.quantity AS cantidad,
  lo.base_price AS precio_base,
  lo.addons_total AS total_agregados,
  lo.final_price AS precio_final,
  lo.payment_method AS metodo_pago,
  lo.configurable_selections AS selecciones_configurables,
  lo.selected_garnishes AS guarniciones,
  -- Datos del estudiante
  s.full_name AS estudiante,
  s.grade AS grado,
  s.section AS seccion,
  -- Datos del menú
  lm.starter AS entrada,
  lm.main_course AS plato_principal,
  lm.beverage AS bebida,
  lm.dessert AS postre,
  lm.notes AS notas_menu,
  -- Categoría del menú
  lc.name AS categoria_menu,
  lc.icon AS icono_categoria,
  -- Colegio
  sch.name AS colegio,
  sch.code AS codigo_colegio
FROM lunch_orders lo
INNER JOIN students s ON lo.student_id = s.id
LEFT JOIN lunch_menus lm ON lo.menu_id = lm.id
LEFT JOIN lunch_categories lc ON COALESCE(lo.category_id, lm.category_id) = lc.id
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.parent_id = 'a00af258-ff8b-4f32-8f79-c88dbc0d4d2d'
ORDER BY lo.order_date DESC, s.full_name;

-- PASO 4: Resumen por estado
SELECT 
  lo.status AS estado,
  lo.is_cancelled AS cancelado,
  COUNT(*) AS cantidad_pedidos,
  SUM(lo.final_price) AS total_soles,
  MIN(lo.order_date) AS fecha_mas_antigua,
  MAX(lo.order_date) AS fecha_mas_reciente
FROM lunch_orders lo
INNER JOIN students s ON lo.student_id = s.id
WHERE s.parent_id = 'a00af258-ff8b-4f32-8f79-c88dbc0d4d2d'
GROUP BY lo.status, lo.is_cancelled
ORDER BY cantidad_pedidos DESC;

-- PASO 5: Resumen por estudiante
SELECT 
  s.full_name AS estudiante,
  COUNT(lo.id) AS total_pedidos,
  SUM(lo.final_price) AS total_pagado_soles,
  MIN(lo.order_date) AS primer_pedido,
  MAX(lo.order_date) AS ultimo_pedido
FROM lunch_orders lo
INNER JOIN students s ON lo.student_id = s.id
WHERE s.parent_id = 'a00af258-ff8b-4f32-8f79-c88dbc0d4d2d'
  AND lo.is_cancelled = false
GROUP BY s.id, s.full_name
ORDER BY s.full_name;

-- PASO 6: Pedidos pendientes de pago (sin transacción pagada)
SELECT 
  lo.id AS pedido_id,
  lo.order_date AS fecha_pedido,
  lo.final_price AS precio_final,
  s.full_name AS estudiante,
  lm.main_course AS plato_principal,
  sch.name AS colegio,
  -- Verificar si tiene transacción
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM transactions t 
      WHERE t.metadata->>'lunch_order_id' = lo.id::text 
        AND t.status = 'completed'
    ) THEN '✅ Pagado'
    WHEN EXISTS (
      SELECT 1 FROM transactions t 
      WHERE t.metadata->>'lunch_order_id' = lo.id::text 
        AND t.status = 'pending'
    ) THEN '⏳ Pendiente de pago'
    ELSE '❌ Sin pago'
  END AS estado_pago
FROM lunch_orders lo
INNER JOIN students s ON lo.student_id = s.id
LEFT JOIN lunch_menus lm ON lo.menu_id = lm.id
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.parent_id = 'a00af258-ff8b-4f32-8f79-c88dbc0d4d2d'
  AND lo.is_cancelled = false
  AND lo.order_date >= CURRENT_DATE - INTERVAL '30 days' -- Últimos 30 días
  AND NOT EXISTS (
    SELECT 1 FROM transactions t 
    WHERE t.metadata->>'lunch_order_id' = lo.id::text 
      AND t.status = 'completed'
  )
ORDER BY lo.order_date DESC;
