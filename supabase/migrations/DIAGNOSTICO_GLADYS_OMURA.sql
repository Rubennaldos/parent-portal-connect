-- ============================================================
-- DIAGNÓSTICO COMPLETO CORREGIDO: GLADYS OMURA
-- gladys.omura17@gmail.com
-- parent_profile_id = 39b020a2-c638-46fc-ade0-a062bbe0864e
-- auth_user_id      = 14218d70-2b5b-487d-9501-adea894f4d96
-- ============================================================

-- ============================================================
-- QUERY A: ¿Hay algún estudiante donde parent_id = su profile?
-- (buscar por parent_profile_id directamente)
-- ============================================================
SELECT 
  s.id AS student_id,
  s.full_name AS alumno,
  s.parent_id,
  sc.name AS sede,
  scc.name AS aula,
  s.grade,
  s.is_active
FROM students s
LEFT JOIN schools sc ON sc.id = s.school_id
LEFT JOIN school_classrooms scc ON scc.id = s.classroom_id
WHERE s.parent_id = '39b020a2-c638-46fc-ade0-a062bbe0864e';

-- ============================================================
-- QUERY B: Buscar alumno por apellido "Omura" en toda la BD
-- (por si el estudiante existe pero no está vinculado)
-- ============================================================
SELECT 
  s.id AS student_id,
  s.full_name AS alumno,
  s.parent_id,
  pp.id AS parent_profile_id,
  au.email AS email_padre,
  sc.name AS sede,
  scc.name AS aula,
  s.is_active
FROM students s
LEFT JOIN parent_profiles pp ON pp.id = s.parent_id
LEFT JOIN auth.users au ON au.id = pp.user_id
LEFT JOIN schools sc ON sc.id = s.school_id
LEFT JOIN school_classrooms scc ON scc.id = s.classroom_id
WHERE s.full_name ILIKE '%omura%'
   OR s.full_name ILIKE '%gladys%';

-- ============================================================
-- QUERY C: Vouchers / solicitudes de recarga enviadas
-- (tabla correcta: recharge_requests)
-- ============================================================
SELECT 
  rr.id,
  rr.created_at,
  rr.amount,
  rr.status,
  rr.reference_code,
  rr.description,
  rr.request_type,
  rr.notes,
  rr.approved_at,
  rr.student_id,
  s.full_name AS alumno
FROM recharge_requests rr
LEFT JOIN students s ON s.id = rr.student_id
WHERE rr.parent_id = '14218d70-2b5b-487d-9501-adea894f4d96'
   OR rr.parent_id = '39b020a2-c638-46fc-ade0-a062bbe0864e'
ORDER BY rr.created_at DESC;

-- ============================================================
-- QUERY D: Si el alumno se encuentra en QUERY B,
-- reemplazar [STUDENT_ID] con el id real y ejecutar:
-- Pedidos de almuerzo del alumno
-- ============================================================
-- SELECT 
--   lo.id AS order_id,
--   lo.created_at,
--   lo.order_date,
--   lo.status,
--   lo.quantity,
--   lm.main_course,
--   lm.date AS menu_date,
--   lc.name AS categoria,
--   lc.price AS precio_cat,
--   lo.payment_status,
--   lo.cancelled_at,
--   lo.cancellation_reason
-- FROM lunch_orders lo
-- LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
-- LEFT JOIN lunch_categories lc ON lc.id = lm.category_id
-- WHERE lo.student_id = '[STUDENT_ID]'
-- ORDER BY lo.order_date DESC, lo.created_at DESC;

-- ============================================================
-- QUERY E: Transacciones del alumno (si se encuentra en B)
-- Reemplazar [STUDENT_ID]
-- ============================================================
-- SELECT 
--   t.id, t.created_at, t.type, t.amount, t.description,
--   t.payment_status, t.payment_method, t.ticket_code
-- FROM transactions t
-- WHERE t.student_id = '[STUDENT_ID]'
-- ORDER BY t.created_at DESC
-- LIMIT 30;

-- ============================================================
-- LIMPIEZA COMPLETA #2: IGNACIO YAMADA OMURA  (28-feb-2026)
-- student_id = 43b21ba6-0a9a-4557-a006-6bc1a4169f72
-- ============================================================

-- PASO 1: Ver pedidos actuales (verificar antes de borrar)
SELECT lo.id, lo.order_date, lo.status, lm.main_course, lc.name AS categoria
FROM lunch_orders lo
LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE lo.student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
ORDER BY lo.order_date;

-- PASO 2: Ver transacciones pendientes actuales
SELECT t.id, t.created_at, t.type, t.amount, t.description, t.payment_status
FROM transactions t
WHERE t.student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
  AND t.payment_status = 'pending'
ORDER BY t.created_at;

-- PASO 3: BORRAR todos los lunch_orders del alumno
DELETE FROM lunch_orders
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72';

-- PASO 4: BORRAR transacciones pendientes huerfanas
DELETE FROM transactions
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
  AND payment_status = 'pending';

-- PASO 5: Verificar que quedo limpio
SELECT 'lunch_orders' AS tabla, COUNT(*) AS registros
FROM lunch_orders WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
UNION ALL
SELECT 'transactions_pending', COUNT(*)
FROM transactions WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72' AND payment_status = 'pending';

-- ============================================================
-- DIAGNÓSTICO: ¿Por qué no aparece el pedido del 3 de marzo?
-- (hijo prueba mc1 - student_id = f00c4391-8a52-405f-a87a-30fc6e91e06e)
-- ============================================================

-- Q1: Ver TODOS los pedidos de hijo prueba mc1
SELECT 
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.created_at,
  lm.main_course,
  lc.name AS categoria
FROM lunch_orders lo
LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE lo.student_id = 'f00c4391-8a52-405f-a87a-30fc6e91e06e'
ORDER BY lo.order_date;

-- Q2: ¿Hay menu disponible para el 3 de marzo en MC1?
SELECT lm.id, lm.date, lm.main_course, lc.name AS categoria, lc.target_type, s.name AS sede
FROM lunch_menus lm
JOIN lunch_categories lc ON lc.id = lm.category_id
JOIN schools s ON s.id = lc.school_id
WHERE lm.date = '2026-03-03'
  AND s.name ILIKE '%Champagnat 1%'
ORDER BY lc.name;
