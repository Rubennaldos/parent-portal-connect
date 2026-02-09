-- ============================================
-- BUSCAR PEDIDOS DE ALMUERZO SIN TRANSACCIONES
-- ============================================

-- Ver todos los pedidos del Profesor 2
SELECT 
    '1. TODOS LOS PEDIDOS' as info,
    lo.id as order_id,
    lo.order_date,
    lo.status,
    lo.is_cancelled,
    lo.created_at,
    lc.price
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lo.category_id = lc.id
WHERE lo.teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
ORDER BY lo.order_date DESC;

-- Ver si hay transacciones con metadata.lunch_order_id
SELECT 
    '2. TRANSACCIONES CON LUNCH_ORDER_ID' as info,
    t.id as transaction_id,
    t.description,
    t.amount,
    t.metadata->>'lunch_order_id' as lunch_order_id,
    t.created_at
FROM transactions t
WHERE t.teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
ORDER BY t.created_at DESC;

-- Verificar si la transacción del almuerzo del 12/02 tiene metadata
SELECT 
    '3. METADATA DE LA TRANSACCIÓN DEL ALMUERZO' as info,
    t.id,
    t.description,
    t.metadata,
    t.created_at
FROM transactions t
WHERE t.id = 'e153b0a6-7bd3-4178-b9fb-0e79a88b5707';
