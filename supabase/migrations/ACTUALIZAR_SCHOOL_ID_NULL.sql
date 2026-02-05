-- ============================================
-- ACTUALIZAR PEDIDOS SIN SCHOOL_ID
-- ============================================
-- Fecha: 2026-02-05
-- Descripción: Actualizar pedidos con school_id NULL
--              para que tengan el school_id de Jean LeBouch
-- ============================================

-- PASO 1: Ver cuántos pedidos se van a actualizar
SELECT COUNT(*) as total_pedidos_sin_school_id
FROM lunch_orders
WHERE school_id IS NULL
  AND order_date >= '2026-02-05';

-- PASO 2: Ver los pedidos que se van a actualizar (vista previa)
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id as school_id_actual,
    '8a0dbd73-0571-4db1-af5c-65f4948c4c98' as school_id_nuevo,
    COALESCE(s.full_name, tp.full_name, lo.manual_name) as nombre
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.school_id IS NULL
  AND lo.order_date >= '2026-02-05'
ORDER BY lo.created_at DESC;

-- PASO 3: ACTUALIZAR (ejecutar después de verificar el PASO 2)
UPDATE lunch_orders
SET school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
WHERE school_id IS NULL
  AND order_date >= '2026-02-05';

-- PASO 4: Verificar que se actualizaron correctamente
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    s.name as nombre_escuela,
    COALESCE(st.full_name, tp.full_name, lo.manual_name) as nombre
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date >= '2026-02-05'
ORDER BY lo.created_at DESC
LIMIT 20;
