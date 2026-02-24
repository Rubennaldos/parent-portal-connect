-- ============================================
-- 🔍 DIAGNÓSTICO: PEDIDOS DESAPARECIDOS MC1
-- Lunes y Viernes reportados como faltantes
-- ============================================

-- ─────────────────────────────────────────────
-- PASO 1: Identificar el school_id de MC1
-- ─────────────────────────────────────────────
SELECT id, name, code FROM schools WHERE code = 'MC1';

-- ─────────────────────────────────────────────
-- PASO 2: Ver TODOS los pedidos de MC1 de las últimas 2 semanas
-- Incluye cancelados y pendientes
-- ─────────────────────────────────────────────
SELECT 
    lo.id,
    lo.order_date,
    TO_CHAR(lo.order_date::date, 'Day') AS dia_semana,
    EXTRACT(DOW FROM lo.order_date::date) AS num_dia, -- 0=Domingo, 1=Lunes, 5=Viernes
    lo.status,
    lo.is_cancelled,
    lo.quantity,
    lo.final_price,
    lo.category_id,
    lc.name AS categoria,
    COALESCE(s.full_name, p.full_name, 'Manual/Externo') AS persona,
    CASE 
        WHEN lo.student_id IS NOT NULL THEN 'Estudiante'
        WHEN lo.teacher_id IS NOT NULL THEN 'Profesor'
        ELSE 'Manual'
    END AS tipo_persona,
    lo.created_at,
    lo.updated_at
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
LEFT JOIN students s ON s.id = lo.student_id
LEFT JOIN profiles p ON p.id = lo.teacher_id
WHERE lo.school_id = (SELECT id FROM schools WHERE code = 'MC1')
AND lo.order_date >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY lo.order_date DESC, lo.created_at DESC;

-- ─────────────────────────────────────────────
-- PASO 3: Resumen por DÍA DE SEMANA en MC1
-- ¿Cuántos pedidos hay por cada día de la semana?
-- ─────────────────────────────────────────────
SELECT 
    TO_CHAR(lo.order_date::date, 'Day') AS dia_semana,
    EXTRACT(DOW FROM lo.order_date::date) AS num_dia,
    COUNT(*) AS total_pedidos,
    COUNT(*) FILTER (WHERE lo.is_cancelled = true) AS cancelados,
    COUNT(*) FILTER (WHERE lo.is_cancelled = false AND lo.status = 'pending') AS pendientes,
    COUNT(*) FILTER (WHERE lo.is_cancelled = false AND lo.status = 'confirmed') AS confirmados,
    COUNT(*) FILTER (WHERE lo.is_cancelled = false AND lo.status = 'delivered') AS entregados
FROM lunch_orders lo
WHERE lo.school_id = (SELECT id FROM schools WHERE code = 'MC1')
AND lo.order_date >= CURRENT_DATE - INTERVAL '14 days'
GROUP BY TO_CHAR(lo.order_date::date, 'Day'), EXTRACT(DOW FROM lo.order_date::date)
ORDER BY num_dia;

-- ─────────────────────────────────────────────
-- PASO 4: ¿Hay MENÚS publicados para lunes y viernes en MC1?
-- Si no hay menús, los padres no pueden pedir
-- ─────────────────────────────────────────────
SELECT 
    lm.id,
    lm.date,
    TO_CHAR(lm.date::date, 'Day') AS dia_semana,
    EXTRACT(DOW FROM lm.date::date) AS num_dia,
    lm.main_course,
    lm.starter,
    lc.name AS categoria
FROM lunch_menus lm
LEFT JOIN lunch_categories lc ON lc.id = lm.category_id
WHERE lm.school_id = (SELECT id FROM schools WHERE code = 'MC1')
AND lm.date >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY lm.date DESC;

-- ─────────────────────────────────────────────
-- PASO 5: Comparar con TODAS LAS SEDES
-- ¿Alguna otra sede tiene el mismo problema?
-- ─────────────────────────────────────────────
SELECT 
    sc.code AS sede,
    sc.name AS nombre_sede,
    TO_CHAR(lo.order_date::date, 'Day') AS dia_semana,
    EXTRACT(DOW FROM lo.order_date::date) AS num_dia,
    COUNT(*) AS total_pedidos,
    COUNT(*) FILTER (WHERE lo.is_cancelled = false) AS activos
FROM lunch_orders lo
JOIN schools sc ON sc.id = lo.school_id
WHERE lo.order_date >= CURRENT_DATE - INTERVAL '14 days'
GROUP BY sc.code, sc.name, TO_CHAR(lo.order_date::date, 'Day'), EXTRACT(DOW FROM lo.order_date::date)
ORDER BY sc.code, num_dia;

-- ─────────────────────────────────────────────
-- PASO 6: ¿Hay pedidos BORRADOS (DELETE) recientemente?
-- Buscar en transacciones huérfanas (tienen lunch_order_id pero no existe la orden)
-- ─────────────────────────────────────────────
SELECT 
    t.id AS transaction_id,
    t.description,
    t.amount,
    t.payment_status,
    t.created_at,
    t.metadata->>'lunch_order_id' AS lunch_order_id_ref,
    t.metadata->>'order_date' AS fecha_pedido,
    t.metadata->>'source' AS fuente
FROM transactions t
WHERE t.school_id = (SELECT id FROM schools WHERE code = 'MC1')
AND t.metadata->>'lunch_order_id' IS NOT NULL
AND t.created_at >= CURRENT_DATE - INTERVAL '14 days'
AND NOT EXISTS (
    SELECT 1 FROM lunch_orders lo WHERE lo.id::text = t.metadata->>'lunch_order_id'
)
ORDER BY t.created_at DESC;

-- ─────────────────────────────────────────────
-- PASO 7: ¿Hay pedidos CANCELADOS en lunes/viernes en MC1?
-- ─────────────────────────────────────────────
SELECT 
    lo.id,
    lo.order_date,
    TO_CHAR(lo.order_date::date, 'Day') AS dia_semana,
    lo.status,
    lo.is_cancelled,
    lo.cancelled_at,
    lo.cancelled_by,
    lo.cancellation_reason,
    COALESCE(s.full_name, p.full_name, 'Manual/Externo') AS persona
FROM lunch_orders lo
LEFT JOIN students s ON s.id = lo.student_id
LEFT JOIN profiles p ON p.id = lo.teacher_id
WHERE lo.school_id = (SELECT id FROM schools WHERE code = 'MC1')
AND lo.order_date >= CURRENT_DATE - INTERVAL '14 days'
AND EXTRACT(DOW FROM lo.order_date::date) IN (1, 5) -- 1=Lunes, 5=Viernes
ORDER BY lo.order_date DESC;

-- ─────────────────────────────────────────────
-- PASO 8: Pedidos con payment_status='pending' que están ocultos
-- (Filtro que agregamos: padres que no pagaron)
-- ─────────────────────────────────────────────
SELECT 
    lo.id,
    lo.order_date,
    TO_CHAR(lo.order_date::date, 'Day') AS dia_semana,
    lo.status,
    lo.student_id,
    s.full_name AS alumno,
    t.payment_status,
    t.id AS transaction_id
FROM lunch_orders lo
LEFT JOIN students s ON s.id = lo.student_id
LEFT JOIN transactions t ON t.metadata->>'lunch_order_id' = lo.id::text
WHERE lo.school_id = (SELECT id FROM schools WHERE code = 'MC1')
AND lo.order_date >= CURRENT_DATE - INTERVAL '14 days'
AND lo.student_id IS NOT NULL
AND lo.is_cancelled = false
ORDER BY lo.order_date DESC;
