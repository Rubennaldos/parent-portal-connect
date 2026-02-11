-- =====================================================
-- INVESTIGACIÓN: TRANSACCIONES DE JUAN CARLOS LYNCH PLANAS
-- =====================================================
-- Fecha: 2026-02-10
-- Propósito: Auditar las 3 transacciones que aparecen en su cuenta
--            para identificar cuál es real y cuáles son duplicadas/erróneas
-- =====================================================

-- 1. BUSCAR AL PROFESOR EN LA BASE DE DATOS
SELECT 
    p.id,
    p.full_name,
    p.email,
    p.role,
    p.school_id,
    s.name as school_name
FROM profiles p
LEFT JOIN schools s ON p.school_id = s.id
WHERE 
    p.full_name ILIKE '%Juan Carlos Lynch%'
    OR p.email ILIKE '%juan%carlos%lynch%'
ORDER BY p.created_at DESC;

-- 2. BUSCAR TODAS SUS TRANSACCIONES PENDIENTES
SELECT 
    t.id,
    t.created_at,
    t.amount,
    t.description,
    t.payment_status,
    t.payment_method,
    t.operation_number,
    t.ticket_number,
    t.created_by,
    t.metadata,
    p.full_name as created_by_name,
    p.role as created_by_role
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
WHERE 
    t.teacher_id IN (
        SELECT id FROM profiles 
        WHERE full_name ILIKE '%Juan Carlos Lynch%'
    )
    AND t.payment_status = 'pending'
ORDER BY t.created_at DESC;

-- 3. BUSCAR LUNCH ORDERS ASOCIADOS
SELECT 
    lo.id,
    lo.order_date,
    lo.meal_type,
    lo.menu_item,
    lo.price,
    lo.created_at,
    lo.teacher_id,
    p.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN profiles p ON lo.teacher_id = p.id
WHERE 
    lo.teacher_id IN (
        SELECT id FROM profiles 
        WHERE full_name ILIKE '%Juan Carlos Lynch%'
    )
    AND lo.order_date >= '2026-02-08'
ORDER BY lo.order_date DESC, lo.created_at DESC;

-- 4. VERIFICAR SI HAY DUPLICADOS
-- Buscar transacciones con misma fecha, monto y descripción
SELECT 
    t.created_at::date as fecha,
    t.amount,
    t.description,
    COUNT(*) as cantidad,
    STRING_AGG(t.id::text, ', ') as transaction_ids,
    STRING_AGG(
        COALESCE(cp.full_name, 'Sistema'),
        ', '
    ) as creadores
FROM transactions t
LEFT JOIN profiles cp ON t.created_by = cp.id
WHERE 
    t.teacher_id IN (
        SELECT id FROM profiles 
        WHERE full_name ILIKE '%Juan Carlos Lynch%'
    )
    AND t.payment_status = 'pending'
GROUP BY t.created_at::date, t.amount, t.description
HAVING COUNT(*) > 1;

-- 5. DETALLES COMPLETOS DE CADA TRANSACCIÓN PENDIENTE
SELECT 
    t.id as transaction_id,
    t.created_at as fecha_creacion,
    t.amount as monto,
    t.description as descripcion,
    t.payment_status as estado,
    t.payment_method as metodo_pago,
    t.operation_number as num_operacion,
    t.ticket_number as num_ticket,
    t.metadata,
    COALESCE(cp.full_name, 'Sistema Automático') as creado_por,
    cp.role as rol_creador,
    cs.name as sede_creador,
    teacher.full_name as profesor,
    ts.name as sede_profesor
FROM transactions t
LEFT JOIN profiles cp ON t.created_by = cp.id
LEFT JOIN schools cs ON cp.school_id = cs.id
LEFT JOIN profiles teacher ON t.teacher_id = teacher.id
LEFT JOIN schools ts ON teacher.school_id = ts.id
WHERE 
    t.teacher_id IN (
        SELECT id FROM profiles 
        WHERE full_name ILIKE '%Juan Carlos Lynch%'
    )
    AND t.payment_status = 'pending'
ORDER BY t.created_at DESC;

-- 6. RESUMEN PARA LA ADMINISTRADORA
SELECT 
    '🔍 RESUMEN DE AUDITORÍA' as info,
    COUNT(*) as total_transacciones_pendientes,
    SUM(t.amount) as monto_total,
    MIN(t.created_at) as primera_transaccion,
    MAX(t.created_at) as ultima_transaccion,
    COUNT(DISTINCT t.created_at::date) as dias_diferentes,
    COUNT(DISTINCT t.created_by) as diferentes_creadores
FROM transactions t
WHERE 
    t.teacher_id IN (
        SELECT id FROM profiles 
        WHERE full_name ILIKE '%Juan Carlos Lynch%'
    )
    AND t.payment_status = 'pending';
