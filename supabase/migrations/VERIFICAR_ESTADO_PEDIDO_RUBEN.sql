-- ============================================
-- VERIFICAR ESTADO ACTUAL DEL PEDIDO DE RUBÉN
-- ============================================

-- Opción 1: Buscar por ID exacto (copiado de la búsqueda anterior)
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    s.name as nombre_escuela,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.id = '2d648a6c-94fd-4db9-ae34-3219a5f7fa3e';

-- Opción 2: Buscar por fecha y nombre (por si acaso el ID cambió)
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    s.name as nombre_escuela,
    tp.full_name as teacher_name,
    lo.created_at
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date = '2026-02-06'
  AND tp.full_name ILIKE '%rubén%alberto%naldos%'
ORDER BY lo.created_at DESC;
