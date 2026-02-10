-- =====================================================
-- INVESTIGAR TRANSACCIONES DE SARINA EN DETALLE
-- =====================================================

-- Ver TODAS las transacciones de Sarina
SELECT 
  '🔍 TODAS LAS TRANSACCIONES DE SARINA' as tipo,
  t.id,
  t.description,
  t.amount,
  TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI:SS') as fecha_creacion,
  COALESCE(p.full_name, '🤖 SISTEMA/NULL') as creado_por,
  t.payment_status,
  t.created_by
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
WHERE t.teacher_id IN (
  SELECT id FROM teacher_profiles WHERE full_name ILIKE '%Sarina%'
)
AND DATE(t.created_at) >= '2026-02-08'
ORDER BY t.created_at;

-- Ver pedidos de almuerzo de Sarina
SELECT 
  '🍽️ PEDIDOS DE ALMUERZO DE SARINA' as tipo,
  lo.id,
  lo.order_date,
  TO_CHAR(lo.created_at, 'YYYY-MM-DD HH24:MI:SS') as fecha_pedido,
  lo.status,
  lm.main_course as plato,
  lc.name as categoria
FROM lunch_orders lo
LEFT JOIN lunch_menus lm ON lo.menu_id = lm.id
LEFT JOIN lunch_categories lc ON lo.category_id = lc.id
WHERE lo.teacher_id IN (
  SELECT id FROM teacher_profiles WHERE full_name ILIKE '%Sarina%'
)
AND lo.order_date >= '2026-02-08'
ORDER BY lo.order_date;
