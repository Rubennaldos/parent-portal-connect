-- Verificar pedidos de profesores y su visibilidad
-- Ejecutar esto en Supabase SQL Editor

-- 1. Ver todos los pedidos de la fecha (sin RLS)
SELECT 
  lo.id,
  lo.order_date,
  lo.status,
  lo.student_id,
  lo.teacher_id,
  CASE 
    WHEN lo.student_id IS NOT NULL THEN 'ALUMNO'
    WHEN lo.teacher_id IS NOT NULL THEN 'PROFESOR'
  END as tipo_pedido,
  s.full_name as alumno_nombre,
  s.school_id as alumno_school,
  t.full_name as profesor_nombre,
  t.school_id_1 as profesor_school
FROM lunch_orders lo
LEFT JOIN students s ON lo.student_id = s.id
LEFT JOIN teacher_profiles t ON lo.teacher_id = t.id
WHERE lo.order_date = '2026-02-02'
ORDER BY lo.created_at DESC;

-- 2. Ver el pedido del profesor específicamente
SELECT 
  lo.*,
  t.full_name,
  t.school_id_1,
  sc.name as school_name
FROM lunch_orders lo
INNER JOIN teacher_profiles t ON lo.teacher_id = t.id
LEFT JOIN schools sc ON t.school_id_1 = sc.id
WHERE lo.order_date = '2026-02-02'
  AND lo.teacher_id IS NOT NULL;

-- 3. Ver las políticas RLS de lunch_orders
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'lunch_orders'
ORDER BY policyname;

-- 4. Verificar el perfil del admin que está consultando
SELECT 
  id,
  email,
  role,
  school_id,
  custom_schools
FROM profiles
WHERE id = 'cba4dba3-369f-4568-82e3-6d185cdb4406';

-- 5. Ver la sede del profesor
SELECT 
  id,
  full_name,
  personal_email,
  school_id_1,
  school_id_2
FROM teacher_profiles
WHERE personal_email = 'profesorjbl@limacafe28.com';
