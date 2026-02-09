-- ============================================
-- VERIFICAR TRANSACCIONES DEL PROFESOR 2
-- ============================================

-- Ver todas las transacciones del Profesor 2
SELECT 
    '1. TODAS LAS TRANSACCIONES' as info,
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

-- Ver específicamente las 2 transacciones que menciona el usuario
SELECT 
    '2. TRANSACCIONES ESPECÍFICAS (08/02 y 11/02)' as info,
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

-- Ver el school_id del Profesor 2
SELECT 
    '3. INFO DEL PROFESOR 2' as info,
    id as teacher_id,
    full_name,
    school_id_1,
    school_id_2
FROM teacher_profiles
WHERE full_name ILIKE '%Profesor 2%';

-- Ver si hay alguna transacción con is_deleted = true
SELECT 
    '4. TRANSACCIONES ELIMINADAS' as info,
    COUNT(*) as total_eliminadas
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Profesor 2%'
AND t.is_deleted = true;
