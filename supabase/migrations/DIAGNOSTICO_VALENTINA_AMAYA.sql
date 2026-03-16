-- DIAGNÓSTICO: ¿Valentina Amaya Segura Castro tiene transacciones por sus almuerzos?

-- Paso 1: Datos del alumno
SELECT id, full_name, balance, free_account, is_active, school_id
FROM students
WHERE full_name ILIKE '%Valentina%Amaya%Segura%'
   OR full_name ILIKE '%Valentina%Segura%Castro%';

-- Paso 2: Pedidos de almuerzo recientes
SELECT 
  lo.id AS orden_id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.student_id,
  lo.created_at,
  lo.final_price,
  lo.category_id
FROM lunch_orders lo
JOIN students s ON lo.student_id = s.id
WHERE (s.full_name ILIKE '%Valentina%Amaya%Segura%'
   OR s.full_name ILIKE '%Valentina%Segura%Castro%')
  AND lo.is_cancelled = false
ORDER BY lo.order_date DESC
LIMIT 20;

-- Paso 3: Transacciones con lunch_order_id (almuerzos)
SELECT 
  t.id AS tx_id,
  t.student_id,
  t.amount,
  t.payment_status,
  t.is_deleted,
  t.type,
  t.description,
  t.created_at,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE (s.full_name ILIKE '%Valentina%Amaya%Segura%'
   OR s.full_name ILIKE '%Valentina%Segura%Castro%')
  AND t.metadata->>'lunch_order_id' IS NOT NULL
ORDER BY t.created_at DESC
LIMIT 20;

-- Paso 4: TODAS las transacciones pendientes (lo que debería aparecer en el Carrito)
SELECT 
  t.id AS tx_id,
  t.student_id,
  t.amount,
  t.payment_status,
  t.is_deleted,
  t.type,
  t.description,
  t.ticket_code,
  t.created_at,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  CASE 
    WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN 'ALMUERZO'
    ELSE 'KIOSCO'
  END AS origen
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE (s.full_name ILIKE '%Valentina%Amaya%Segura%'
   OR s.full_name ILIKE '%Valentina%Segura%Castro%')
  AND t.type = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND t.is_deleted = false
ORDER BY t.created_at DESC;

-- Paso 5: Contar pedidos VS transacciones (¿hay huérfanos?)
SELECT
  'Pedidos activos' AS concepto,
  COUNT(*) AS cantidad
FROM lunch_orders lo
JOIN students s ON lo.student_id = s.id
WHERE (s.full_name ILIKE '%Valentina%Amaya%Segura%'
   OR s.full_name ILIKE '%Valentina%Segura%Castro%')
  AND lo.is_cancelled = false

UNION ALL

SELECT
  'Transacciones de almuerzo' AS concepto,
  COUNT(*) AS cantidad
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE (s.full_name ILIKE '%Valentina%Amaya%Segura%'
   OR s.full_name ILIKE '%Valentina%Segura%Castro%')
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND t.is_deleted = false;
