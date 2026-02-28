-- =====================================================
-- BORRADO COMPLETO: Almuerzo Light de Pescado y Almuerzo Light de Pollo
-- Sede: St. George's Miraflores
-- Desde: 9 de marzo de 2026 en adelante
-- INCLUYE: transacciones pagadas (la sede gestiona comprobantes manualmente)
-- =====================================================
-- ⚠️  EJECUTAR EN ORDEN, PASO A PASO
-- =====================================================


-- ============================================================
-- PASO 1: VERIFICACIÓN FINAL (solo lectura, no borra nada)
-- ============================================================
SELECT 'TRANSACCIONES (paid + pending)' AS que_se_borra, COUNT(*) AS cantidad
FROM transactions t
WHERE (t.metadata->>'lunch_order_id')::text IN (
  SELECT lo.id::text
  FROM lunch_orders lo
  JOIN lunch_menus lm ON lo.menu_id = lm.id
  WHERE lm.category_id IN (
    '8c2f88ed-211a-45e9-92f0-b905dae03daf',
    '95b11bbb-f0a5-4325-b29a-b96001d75f30'
  )
  AND lo.order_date >= '2026-03-09'
)

UNION ALL

SELECT 'RECHARGE REQUESTS (vouchers)', COUNT(*)
FROM recharge_requests rr
WHERE rr.lunch_order_ids && ARRAY(
  SELECT lo.id
  FROM lunch_orders lo
  JOIN lunch_menus lm ON lo.menu_id = lm.id
  WHERE lm.category_id IN (
    '8c2f88ed-211a-45e9-92f0-b905dae03daf',
    '95b11bbb-f0a5-4325-b29a-b96001d75f30'
  )
  AND lo.order_date >= '2026-03-09'
)

UNION ALL

SELECT 'PEDIDOS (lunch_orders)', COUNT(*)
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
WHERE lm.category_id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
)
AND lo.order_date >= '2026-03-09'

UNION ALL

SELECT 'MENÚS (lunch_menus)', COUNT(*)
FROM lunch_menus
WHERE category_id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
)
AND date >= '2026-03-09'

UNION ALL

SELECT 'CATEGORÍAS A DESACTIVAR', COUNT(*)
FROM lunch_categories
WHERE id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
);


-- ============================================================
-- PASO 2: BORRAR TRANSACCIONES (incluyendo las pagadas)
-- ============================================================
DELETE FROM transactions
WHERE (metadata->>'lunch_order_id')::text IN (
  SELECT lo.id::text
  FROM lunch_orders lo
  JOIN lunch_menus lm ON lo.menu_id = lm.id
  WHERE lm.category_id IN (
    '8c2f88ed-211a-45e9-92f0-b905dae03daf',
    '95b11bbb-f0a5-4325-b29a-b96001d75f30'
  )
  AND lo.order_date >= '2026-03-09'
);


-- ============================================================
-- PASO 3: BORRAR RECHARGE REQUESTS (vouchers enviados)
-- ============================================================
DELETE FROM recharge_requests
WHERE lunch_order_ids && ARRAY(
  SELECT lo.id
  FROM lunch_orders lo
  JOIN lunch_menus lm ON lo.menu_id = lm.id
  WHERE lm.category_id IN (
    '8c2f88ed-211a-45e9-92f0-b905dae03daf',
    '95b11bbb-f0a5-4325-b29a-b96001d75f30'
  )
  AND lo.order_date >= '2026-03-09'
);


-- ============================================================
-- PASO 4: BORRAR PEDIDOS (lunch_orders)
-- ============================================================
DELETE FROM lunch_orders
WHERE menu_id IN (
  SELECT id FROM lunch_menus
  WHERE category_id IN (
    '8c2f88ed-211a-45e9-92f0-b905dae03daf',
    '95b11bbb-f0a5-4325-b29a-b96001d75f30'
  )
  AND date >= '2026-03-09'
);


-- ============================================================
-- PASO 5: BORRAR MENÚS (lunch_menus)
-- ============================================================
DELETE FROM lunch_menus
WHERE category_id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
)
AND date >= '2026-03-09';


-- ============================================================
-- PASO 6: DESACTIVAR LAS CATEGORÍAS
-- ============================================================
UPDATE lunch_categories
SET is_active = false
WHERE id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
);


-- ============================================================
-- PASO 7: VERIFICACIÓN FINAL — todo debe mostrar 0
-- ============================================================
SELECT 'Transacciones restantes'        AS verificacion, COUNT(*) AS debe_ser_0
FROM transactions
WHERE (metadata->>'lunch_order_id')::text IN (
  SELECT lo.id::text FROM lunch_orders lo
  JOIN lunch_menus lm ON lo.menu_id = lm.id
  WHERE lm.category_id IN (
    '8c2f88ed-211a-45e9-92f0-b905dae03daf',
    '95b11bbb-f0a5-4325-b29a-b96001d75f30'
  )
)

UNION ALL

SELECT 'Pedidos restantes', COUNT(*)
FROM lunch_orders lo
JOIN lunch_menus lm ON lo.menu_id = lm.id
WHERE lm.category_id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
)

UNION ALL

SELECT 'Menús restantes desde 9 mar', COUNT(*)
FROM lunch_menus
WHERE category_id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
)
AND date >= '2026-03-09'

UNION ALL

SELECT 'Categorías aún activas (debe ser 0)', COUNT(*)
FROM lunch_categories
WHERE id IN (
  '8c2f88ed-211a-45e9-92f0-b905dae03daf',
  '95b11bbb-f0a5-4325-b29a-b96001d75f30'
)
AND is_active = true;
