-- Ver específicamente las 2 transacciones del 08/02 y 11/02
SELECT 
    t.id,
    t.description,
    t.amount,
    t.payment_status,
    t.payment_method,
    t.type,
    t.created_at,
    DATE(t.created_at) as fecha,
    t.school_id,
    tp.full_name
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Profesor 2%'
AND t.amount = -13.00
AND (
    DATE(t.created_at) = '2026-02-08' OR 
    DATE(t.created_at) = '2026-02-11'
)
ORDER BY t.created_at DESC;
