-- ============================================
-- CORREGIR SOLO PEDIDOS DE RUBÉN
-- ============================================
-- Cambiar de Jean LeBouch → Saint George Miraflores
-- Solo los pedidos de Rubén Alberto Naldos Nuñez
-- ============================================

-- PASO 1: Actualizar SOLO los pedidos de Rubén con Jean LeBouch
UPDATE lunch_orders
SET school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
WHERE id IN (
    '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e',
    '305347fc-13ff-4145-9ee4-d9c9d1f28fd3'
);

-- PASO 2: Verificar que se actualizaron correctamente
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    s.name as nombre_escuela,
    s.code as codigo_escuela,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE tp.full_name ILIKE '%ruben%naldos%'
   OR tp.full_name ILIKE '%beto%naldos%'
ORDER BY lo.created_at DESC;
