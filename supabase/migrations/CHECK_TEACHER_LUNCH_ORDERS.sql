-- ============================================
-- INVESTIGAR PEDIDOS DE ALMUERZO DEL PROFESOR 2
-- ============================================

-- 0️⃣ Identificar al Profesor 2
SELECT 
    '0. INFO del Profesor 2' as info,
    id,
    full_name,
    dni
FROM teacher_profiles
WHERE full_name ILIKE '%Profesor 2%';

-- 1️⃣ Ver todos los pedidos de almuerzo del profesor
SELECT 
    '1. PEDIDOS EN lunch_orders' as info,
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

-- 2️⃣ Ver TODAS las transacciones del profesor
SELECT 
    '2. TODAS las transacciones del Profesor 2' as info,
    t.id,
    t.teacher_id,
    t.type,
    t.amount,
    t.description,
    t.created_at,
    t.payment_method
FROM transactions t
WHERE t.teacher_id IN (
    SELECT id 
    FROM teacher_profiles 
    WHERE full_name ILIKE '%Profesor 2%'
)
ORDER BY t.created_at DESC;

-- 3️⃣ Ver solo transacciones de almuerzo
SELECT 
    '3. TRANSACCIONES de almuerzos' as info,
    t.id,
    t.teacher_id,
    t.type,
    t.amount,
    t.description,
    t.created_at
FROM transactions t
WHERE t.teacher_id IN (
    SELECT id 
    FROM teacher_profiles 
    WHERE full_name ILIKE '%Profesor 2%'
)
AND t.description ILIKE '%almuerzo%'
ORDER BY t.created_at DESC;
