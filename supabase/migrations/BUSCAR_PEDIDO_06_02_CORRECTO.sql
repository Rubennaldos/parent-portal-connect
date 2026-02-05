-- ============================================
-- BUSCAR EL PEDIDO CORRECTO DE RUBÉN DEL 06/02
-- ============================================

-- Buscar por fecha 06/02 y nombre
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    lo.created_at,
    s.name as nombre_escuela,
    tp.full_name as teacher_name,
    tp.id as teacher_id
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date = '2026-02-06'
  AND (
    tp.full_name ILIKE '%ruben%naldos%'
    OR tp.full_name ILIKE '%rubén%naldos%'
  )
ORDER BY lo.created_at DESC;
