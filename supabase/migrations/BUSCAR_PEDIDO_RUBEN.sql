-- ============================================
-- BUSCAR PEDIDO DE RUBÉN ALBERTO NALDOS NÚÑEZ
-- ============================================

-- Buscar el pedido de Rubén (puede ser manual_name o teacher)
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    lo.student_id,
    lo.teacher_id,
    lo.manual_name,
    lo.created_at,
    s.name as nombre_escuela,
    st.full_name as student_name,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE 
    lo.manual_name ILIKE '%ruben%' 
    OR lo.manual_name ILIKE '%alberto%'
    OR lo.manual_name ILIKE '%naldos%'
    OR tp.full_name ILIKE '%ruben%'
    OR tp.full_name ILIKE '%naldos%'
ORDER BY lo.created_at DESC
LIMIT 10;
