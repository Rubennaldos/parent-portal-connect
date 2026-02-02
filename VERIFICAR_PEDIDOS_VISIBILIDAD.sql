-- ============================================
-- VERIFICAR PEDIDOS Y SU VISIBILIDAD
-- ============================================

-- 1. Ver TODOS los pedidos (sin filtro)
SELECT 
  lo.id,
  lo.student_id,
  lo.order_date,
  lo.status,
  lo.created_at,
  s.full_name as student_name,
  s.parent_id,
  sch.name as school_name
FROM public.lunch_orders lo
JOIN public.students s ON lo.student_id = s.id
JOIN public.schools sch ON s.school_id = sch.id
ORDER BY lo.created_at DESC
LIMIT 20;

-- 2. Contar pedidos por fecha
SELECT 
  order_date,
  COUNT(*) as total_pedidos,
  STRING_AGG(DISTINCT status, ', ') as estados
FROM public.lunch_orders
GROUP BY order_date
ORDER BY order_date DESC;

-- 3. Ver estudiantes y sus padres
SELECT 
  s.id as student_id,
  s.full_name as student_name,
  s.parent_id,
  s.school_id,
  sch.name as school_name
FROM public.students s
JOIN public.schools sch ON s.school_id = sch.id
WHERE s.is_active = true
LIMIT 10;

-- 4. Verificar políticas RLS de lunch_orders
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'lunch_orders';
