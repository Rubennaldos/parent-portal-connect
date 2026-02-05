-- ============================================
-- DIAGNÓSTICO: Verificar por qué el pedido no aparece
-- ============================================
-- Fecha: 2026-02-05
-- ============================================

-- 1. Ver el ÚLTIMO pedido creado (el que acabas de crear)
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.is_cancelled,
    lo.student_id,
    lo.teacher_id,
    lo.manual_name,
    lo.school_id,
    lo.created_at,
    s.full_name as student_name,
    tp.full_name as teacher_name,
    sc.name as school_name
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
LEFT JOIN schools sc ON lo.school_id = sc.id
ORDER BY lo.created_at DESC
LIMIT 5;

-- 2. Ver todos los pedidos del 9 de febrero (la fecha del modal)
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.is_cancelled,
    lo.student_id,
    lo.teacher_id,
    lo.manual_name,
    lo.school_id,
    s.full_name as student_name,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date = '2026-02-09'
ORDER BY lo.created_at DESC;

-- 3. Ver cuántos pedidos hay para HOY (2026-02-05)
SELECT 
    COUNT(*) as total_pedidos_hoy
FROM lunch_orders
WHERE order_date = '2026-02-05';

-- 4. Ver todos los pedidos de HOY con detalles
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.is_cancelled,
    lo.school_id,
    s.full_name as student_name,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date = '2026-02-05'
ORDER BY lo.created_at DESC;
