-- Ver la primera parte del resultado (pedidos incluyendo cancelados)
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
