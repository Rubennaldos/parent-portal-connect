-- ============================================
-- CORREGIR SOLO 1 PEDIDO: Rubén del 06/02
-- ============================================

-- PASO 1: Actualizar SOLO el pedido del 06/02
UPDATE lunch_orders
SET school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
WHERE id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';

-- PASO 2: Verificar
SELECT 
    lo.id,
    lo.order_date,
    lo.school_id,
    s.name as nombre_escuela,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';
