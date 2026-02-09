-- ============================================
-- VERIFICAR SI HAY PEDIDOS CANCELADOS O HISTÓRICOS
-- ============================================

-- Ver TODOS los pedidos del profesor (incluyendo cancelados)
SELECT 
    lo.id,
    lo.teacher_id,
    lo.order_date,
    lo.created_at,
    lo.status,
    lo.menu_id,
    lo.cancelled_at,
    lo.cancellation_reason
FROM lunch_orders lo
WHERE lo.teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
ORDER BY lo.created_at DESC;

-- Ver si la transacción del 11 de febrero está vinculada a algún pedido
SELECT 
    'Transacción del 11 de febrero' as info,
    t.*
FROM transactions t
WHERE t.id = 'c24b3a41-36af-462b-96ae-247f04ae64f5';
