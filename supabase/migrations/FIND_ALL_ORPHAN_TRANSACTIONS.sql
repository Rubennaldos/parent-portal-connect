-- ============================================
-- BUSCAR TRANSACCIONES HUÉRFANAS DE ALMUERZOS
-- ============================================

-- Buscar transacciones de almuerzo que NO tienen pedido correspondiente
WITH lunch_transactions AS (
    SELECT 
        t.id as transaction_id,
        t.teacher_id,
        t.description,
        t.amount,
        t.created_at,
        t.payment_status,
        t.payment_method,
        tp.full_name as teacher_name
    FROM transactions t
    LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
    WHERE t.description ILIKE '%almuerzo%'
    AND t.teacher_id IS NOT NULL
),
lunch_orders_list AS (
    SELECT 
        lo.teacher_id,
        lo.order_date,
        lo.status
    FROM lunch_orders lo
    WHERE lo.teacher_id IS NOT NULL
)
SELECT 
    '1. TRANSACCIONES HUÉRFANAS (sin pedido)' as info,
    lt.transaction_id,
    lt.teacher_name,
    lt.description,
    lt.amount,
    lt.payment_status,
    lt.payment_method,
    lt.created_at
FROM lunch_transactions lt
LEFT JOIN lunch_orders_list lo ON lt.teacher_id = lo.teacher_id 
    AND lt.description ILIKE '%' || to_char(lo.order_date, 'DD de Month') || '%'
WHERE lo.teacher_id IS NULL
ORDER BY lt.created_at DESC;

-- Contar totales
SELECT 
    '2. RESUMEN' as info,
    COUNT(DISTINCT t.id) as total_transacciones_almuerzo,
    COUNT(DISTINCT lo.id) as total_pedidos_almuerzo,
    COUNT(DISTINCT t.id) - COUNT(DISTINCT lo.id) as diferencia
FROM transactions t
LEFT JOIN lunch_orders lo ON t.teacher_id = lo.teacher_id
WHERE t.description ILIKE '%almuerzo%'
AND t.teacher_id IS NOT NULL;

-- Ver todas las transacciones con payment_status y payment_method
SELECT 
    '3. TRANSACCIONES con payment_status' as info,
    t.id,
    t.teacher_id,
    tp.full_name,
    t.type,
    t.amount,
    t.description,
    t.payment_status,
    t.payment_method,
    t.created_at
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.teacher_id IS NOT NULL
ORDER BY t.created_at DESC
LIMIT 50;
