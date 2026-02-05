-- ============================================
-- SOLUCIÓN: Ver el school_id de la cajera
-- ============================================

-- 1. Ver TODAS las escuelas disponibles
SELECT 
    id as school_id,
    name as nombre_escuela,
    code as codigo
FROM schools
ORDER BY name;

-- 2. Ver los últimos 10 pedidos sin school_id (NULL)
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    lo.student_id,
    lo.teacher_id,
    lo.manual_name,
    lo.created_at,
    s.full_name as student_name,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.school_id IS NULL
  AND lo.order_date >= '2026-02-05'
ORDER BY lo.created_at DESC
LIMIT 10;

-- 3. Ver los pedidos de HOY con su school_id (para comparar)
SELECT 
    lo.id,
    lo.order_date,
    lo.school_id,
    s.name as nombre_escuela,
    st.full_name as student_name,
    tp.full_name as teacher_name
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date = '2026-02-05'
ORDER BY lo.created_at DESC
LIMIT 10;

-- 4. Actualizar los pedidos sin school_id para que tengan el school_id correcto
-- PRIMERO EJECUTA LOS QUERIES ANTERIORES Y VERIFICA CUÁL ES EL SCHOOL_ID CORRECTO
-- Luego descomenta y reemplaza 'TU_SCHOOL_ID_AQUI' con el school_id correcto
/*
UPDATE lunch_orders
SET school_id = 'TU_SCHOOL_ID_AQUI'
WHERE school_id IS NULL
  AND order_date >= '2026-02-05';
*/
