-- ═══════════════════════════════════════════════
-- VERIFICAR PEDIDOS DEL 11 DE FEBRERO: Angie
-- UID: fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07
-- ═══════════════════════════════════════════════

-- PASO 1: Ver TODOS los pedidos que se crearon el 11 de febrero (independientemente de la fecha de entrega)
SELECT 
  'Pedido creado el 11 Feb' AS tipo,
  lo.id,
  lo.order_date AS fecha_entrega,
  lo.status,
  lo.is_cancelled,
  lo.final_price,
  lo.created_at AS fecha_creacion,
  lc.name AS categoria,
  lm.main_course AS plato
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND DATE(lo.created_at) = '2026-02-11'
ORDER BY lo.created_at ASC;

-- PASO 2: Ver TODAS las transacciones creadas el 11 de febrero
SELECT 
  'Transacción creada el 11 Feb' AS tipo,
  t.id,
  t.created_at AS fecha_creacion,
  t.description,
  ABS(t.amount) AS monto,
  t.payment_status,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'order_date' AS order_date_metadata,
  t.metadata->>'source' AS source
FROM transactions t
WHERE t.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND DATE(t.created_at) = '2026-02-11'
ORDER BY t.created_at ASC;

-- PASO 3: Ver específicamente pedidos para el 11 de febrero (order_date = 2026-02-11)
SELECT 
  'Pedido PARA el 11 Feb' AS tipo,
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.final_price,
  lo.created_at,
  lc.name AS categoria,
  lm.main_course AS plato
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND lo.order_date = '2026-02-11'
ORDER BY lo.created_at ASC;

-- PASO 4: Ver transacciones que mencionan "11 de febrero" en la descripción
SELECT 
  'Transacción para 11 Feb' AS tipo,
  t.id,
  t.created_at,
  t.description,
  ABS(t.amount) AS monto,
  t.payment_status,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'order_date' AS order_date_metadata
FROM transactions t
WHERE t.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND (t.description LIKE '%11 de febrero%' 
       OR t.description LIKE '%febrero - 11%'
       OR (t.metadata->>'order_date')::date = '2026-02-11')
ORDER BY t.created_at ASC;
