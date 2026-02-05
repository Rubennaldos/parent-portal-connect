-- ============================================
-- ACTUALIZAR PEDIDO - ÚLTIMO INTENTO
-- ============================================

-- Ver estado ANTES del update
SELECT 
    id,
    order_date,
    school_id,
    'ANTES' as momento
FROM lunch_orders
WHERE id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';

-- Ejecutar UPDATE
UPDATE lunch_orders
SET school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
WHERE id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';

-- Ver estado DESPUÉS del update
SELECT 
    lo.id,
    lo.order_date,
    lo.school_id,
    s.name as nombre_escuela,
    s.code as codigo,
    'DESPUES' as momento
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
WHERE lo.id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';
