-- ============================================
-- BUSCAR EN EL HISTORIAL SI HUBO MÁS TRANSACCIONES
-- ============================================

-- Buscar la transacción del 11/02 que eliminamos
-- (Esta era: c24b3a41-36af-462b-96ae-247f04ae64f5)

-- Verificar si hay alguna transacción del 08/02 para el Profesor 2
SELECT 
    'Transacciones del 08/02' as info,
    t.id,
    t.description,
    t.amount,
    t.payment_status,
    t.created_at,
    tp.full_name
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Profesor 2%'
AND DATE(t.created_at) = '2026-02-08'
ORDER BY t.created_at DESC;

-- Ver TODAS las transacciones del Profesor 2 agrupadas por fecha de creación
SELECT 
    'Resumen por fecha' as info,
    DATE(t.created_at) as fecha_creacion,
    COUNT(*) as total_transacciones,
    SUM(t.amount) as total_monto
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Profesor 2%'
GROUP BY DATE(t.created_at)
ORDER BY DATE(t.created_at) DESC;

-- Ver si el portal del profesor está mostrando datos en cache
-- Verificar todas las transacciones actuales
SELECT 
    'TODAS LAS TRANSACCIONES ACTUALES' as info,
    t.id,
    t.description,
    t.amount,
    t.payment_status,
    DATE(t.created_at) as fecha_creacion,
    t.created_at as timestamp_completo
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE tp.full_name ILIKE '%Profesor 2%'
ORDER BY t.created_at DESC;
