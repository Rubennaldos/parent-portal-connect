-- ============================================
-- VERIFICAR USUARIO adminjbl@limacafe28.com
-- ============================================

-- 1. Ver el perfil completo del admin de Jean LeBouch
SELECT 
  p.id,
  p.email,
  p.role,
  p.full_name,
  p.school_id,
  s.name as school_name,
  p.created_at
FROM public.profiles p
LEFT JOIN public.schools s ON p.school_id = s.id
WHERE p.email = 'adminjbl@limacafe28.com';

-- 2. Ver si existe en auth.users
SELECT 
  au.id,
  au.email,
  au.created_at,
  au.last_sign_in_at,
  p.role,
  p.school_id
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE au.email = 'adminjbl@limacafe28.com';

-- 3. Ver los pedidos de la sede Jean LeBouch (fecha de hoy)
SELECT 
  lo.id,
  lo.order_date,
  lo.status,
  lo.student_id,
  s.full_name as student_name,
  s.school_id,
  sch.name as school_name
FROM public.lunch_orders lo
JOIN public.students s ON lo.student_id = s.id
JOIN public.schools sch ON s.school_id = sch.id
WHERE s.school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
AND lo.order_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY lo.order_date DESC, lo.created_at DESC
LIMIT 50;

-- 4. Contar pedidos por sede
SELECT 
  sch.name as school_name,
  lo.order_date,
  COUNT(*) as total_pedidos
FROM public.lunch_orders lo
JOIN public.students s ON lo.student_id = s.id
JOIN public.schools sch ON s.school_id = sch.id
WHERE lo.order_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY sch.name, lo.order_date
ORDER BY lo.order_date DESC, sch.name;

-- 5. Ver si la política RLS está bloqueando (ejecutar como admin_general)
-- Esta query debe ejecutarse sin problemas porque es a través del dashboard
SELECT COUNT(*) as total_pedidos_jean_lebouch
FROM public.lunch_orders lo
JOIN public.students s ON lo.student_id = s.id
WHERE s.school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98';
