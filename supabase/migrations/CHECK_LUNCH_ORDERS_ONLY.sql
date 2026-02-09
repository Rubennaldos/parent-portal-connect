-- ============================================
-- CONSULTA 1: Ver todos los pedidos de almuerzo del profesor
-- ============================================
SELECT 
    lo.id,
    lo.teacher_id,
    lo.order_date,
    lo.created_at,
    lo.status,
    lo.menu_id
FROM lunch_orders lo
WHERE lo.teacher_id IN (
    SELECT id 
    FROM teacher_profiles 
    WHERE full_name ILIKE '%Profesor 2%'
)
ORDER BY lo.created_at DESC;
