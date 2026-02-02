-- ============================================
-- PASO 2: VER LOS 4 PEDIDOS DE JEAN LEBOUCH
-- ============================================
SELECT 
  lo.id,
  lo.order_date,
  lo.status,
  lo.student_id,
  lo.created_at
FROM public.lunch_orders lo
WHERE lo.student_id IN (
  SELECT id 
  FROM public.students 
  WHERE school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
)
ORDER BY lo.created_at DESC;
