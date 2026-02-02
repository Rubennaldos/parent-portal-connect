-- ============================================
-- VERIFICAR PEDIDOS CREADOS Y SU ESTRUCTURA
-- ============================================

-- 1. Ver estructura de la tabla lunch_orders
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'lunch_orders' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Ver los últimos pedidos creados
SELECT 
  lo.*,
  s.full_name as student_name,
  s.parent_id
FROM public.lunch_orders lo
JOIN public.students s ON lo.student_id = s.id
ORDER BY lo.created_at DESC
LIMIT 10;

-- 3. Ver columnas reales (SIN ordered_at)
SELECT 
  COUNT(*) as total_pedidos,
  COUNT(created_at) as con_created_at
FROM public.lunch_orders;
