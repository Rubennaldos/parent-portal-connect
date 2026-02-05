-- ============================================
-- REVERTIR Y ARREGLAR CORRECTAMENTE
-- ============================================
-- Fecha: 2026-02-05
-- ============================================

-- PROBLEMA: Cambié TODOS los pedidos sin discriminar
-- SOLUCIÓN: Solo cambiar los pedidos del 05/02 que YO creé

-- PASO 1: Ver los pedidos del 06/02 (que NO deberían haber cambiado)
SELECT 
    lo.id,
    lo.order_date,
    lo.school_id,
    s.name as nombre_escuela,
    COALESCE(st.full_name, tp.full_name, lo.manual_name) as nombre
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date = '2026-02-06'
ORDER BY lo.created_at DESC
LIMIT 5;

-- PASO 2: Ver los pedidos del 05/02
SELECT 
    lo.id,
    lo.order_date,
    lo.school_id,
    s.name as nombre_escuela,
    COALESCE(st.full_name, tp.full_name, lo.manual_name) as nombre
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date = '2026-02-05'
ORDER BY lo.created_at DESC;

-- ============================================
-- NO EJECUTAR NADA MÁS HASTA REVISAR
-- ============================================
