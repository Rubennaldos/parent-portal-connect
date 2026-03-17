-- ============================================================
-- CONSULTA: Hijos de penakaren003@gmail.com y si han pedido algo
-- Ejecutar en Supabase SQL Editor (cada bloque por separado si hace falta)
-- UID del usuario (mamá): ec00bc50-badc-432b-994c-80a8bd6a37cd
-- ============================================================

-- 1) Hijos de esta mamá (parent_id = user id de la mamá)
SELECT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.grade AS grado,
  s.section AS seccion,
  sch.name AS sede
FROM students s
LEFT JOIN schools sch ON sch.id = s.school_id
WHERE s.parent_id = 'ec00bc50-badc-432b-994c-80a8bd6a37cd'
  AND s.is_active = true
ORDER BY s.full_name;

-- 2) Pedidos de almuerzo (lunch_orders) de esos hijos
SELECT
  s.full_name AS hijo,
  lo.order_date AS fecha_pedido,
  lo.quantity AS cantidad,
  lo.base_price AS precio_base,
  lo.final_price AS precio_final,
  lo.status AS estado,
  lo.is_cancelled AS cancelado,
  lm.main_course AS plato_principal,
  lo.created_at AT TIME ZONE 'America/Lima' AS creado_lima
FROM lunch_orders lo
INNER JOIN students s ON s.id = lo.student_id
LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
WHERE s.parent_id = 'ec00bc50-badc-432b-994c-80a8bd6a37cd'
ORDER BY lo.order_date DESC, lo.created_at DESC;

-- 3) Resumen: ¿cuántos pedidos en total?
SELECT
  COUNT(*) AS total_pedidos,
  COUNT(*) FILTER (WHERE lo.is_cancelled = false) AS pedidos_activos,
  MIN(lo.order_date) AS primer_pedido,
  MAX(lo.order_date) AS ultimo_pedido
FROM lunch_orders lo
INNER JOIN students s ON s.id = lo.student_id
WHERE s.parent_id = 'ec00bc50-badc-432b-994c-80a8bd6a37cd';
