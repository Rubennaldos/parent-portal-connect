-- =====================================================
-- CORREGIR PEDIDOS SIN SCHOOL_ID
-- =====================================================
-- Actualizar pedidos de profesores que no tienen school_id
-- usando el school_id_1 del profesor

-- 1. Ver cuántos pedidos de profesores NO tienen school_id
SELECT 
  'Pedidos de profesores sin school_id:' as descripcion,
  COUNT(*) as total
FROM lunch_orders lo
WHERE lo.teacher_id IS NOT NULL 
  AND lo.school_id IS NULL;

-- 2. Ver cuántos pedidos de estudiantes NO tienen school_id
SELECT 
  'Pedidos de estudiantes sin school_id:' as descripcion,
  COUNT(*) as total
FROM lunch_orders lo
WHERE lo.student_id IS NOT NULL 
  AND lo.school_id IS NULL;

-- 3. Actualizar pedidos de profesores sin school_id
UPDATE lunch_orders lo
SET school_id = tp.school_id_1
FROM teacher_profiles tp
WHERE lo.teacher_id = tp.id
  AND lo.school_id IS NULL
  AND tp.school_id_1 IS NOT NULL;

-- 4. Actualizar pedidos de estudiantes sin school_id
UPDATE lunch_orders lo
SET school_id = s.school_id
FROM students s
WHERE lo.student_id = s.id
  AND lo.school_id IS NULL
  AND s.school_id IS NOT NULL;

-- 5. Verificar que se actualizaron correctamente
SELECT 
  'Pedidos corregidos de profesores:' as descripcion,
  COUNT(*) as total
FROM lunch_orders lo
INNER JOIN teacher_profiles tp ON lo.teacher_id = tp.id
WHERE lo.school_id = tp.school_id_1;

SELECT 
  'Pedidos corregidos de estudiantes:' as descripcion,
  COUNT(*) as total
FROM lunch_orders lo
INNER JOIN students s ON lo.student_id = s.id
WHERE lo.school_id = s.school_id;

-- 6. Ver si aún quedan pedidos sin school_id
SELECT 
  'Pedidos que aún NO tienen school_id:' as descripcion,
  COUNT(*) as total
FROM lunch_orders
WHERE school_id IS NULL;
