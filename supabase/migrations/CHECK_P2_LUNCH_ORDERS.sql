-- Ver TODOS los pedidos de almuerzo del Profesor 2
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.created_at,
    lo.is_cancelled,
    lc.price as precio_categoria
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lo.category_id = lc.id
WHERE lo.teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
ORDER BY lo.order_date DESC;
