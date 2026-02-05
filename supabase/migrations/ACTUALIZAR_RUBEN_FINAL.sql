-- ============================================
-- ACTUALIZAR PEDIDO DE RUBÉN - ID CORRECTO
-- ============================================

-- Actualizar de Jean LeBouch → Saint George Miraflores
UPDATE lunch_orders
SET school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
WHERE id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';

-- Verificar que se actualizó
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    s.name as nombre_escuela,
    s.code as codigo,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';
