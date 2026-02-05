-- ============================================
-- CORREGIR SCHOOL_ID - Cambiar a Saint George Miraflores
-- ============================================
-- Fecha: 2026-02-05
-- ============================================

-- Saint George Miraflores school_id: 2a50533d-7fc1-4096-80a7-e20a41bda5a0

-- PASO 1: Actualizar todos los pedidos de Jean LeBouch → Saint George Miraflores
UPDATE lunch_orders
SET school_id = '2a50533d-7fc1-4096-80a7-e20a41bda5a0'
WHERE school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
  AND order_date >= '2026-02-05';

-- PASO 2: Verificar que se actualizaron correctamente
SELECT 
    lo.id,
    lo.order_date,
    lo.status,
    lo.school_id,
    s.name as nombre_escuela,
    s.code as codigo_escuela,
    COALESCE(st.full_name, tp.full_name, lo.manual_name) as nombre
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
LEFT JOIN students st ON lo.student_id = st.id
LEFT JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.order_date >= '2026-02-05'
ORDER BY lo.created_at DESC
LIMIT 20;
