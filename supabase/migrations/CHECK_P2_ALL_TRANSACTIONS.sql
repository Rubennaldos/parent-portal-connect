-- Ver todas las transacciones del Profesor 2
SELECT 
    t.id,
    t.description,
    t.amount,
    t.payment_status,
    t.payment_method,
    t.type,
    t.created_at,
    t.school_id,
    tp.full_name
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Profesor 2%'
ORDER BY t.created_at DESC;
