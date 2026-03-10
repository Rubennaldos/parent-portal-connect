-- ============================================================
-- DIAGNÓSTICO: ¿Por qué no aparece el almuerzo del 2 de marzo de Caleb en Cobranzas?
-- ============================================================

-- PASO 1: Buscar el estudiante Caleb
SELECT id, full_name, school_id, balance, free_account
FROM students
WHERE full_name ILIKE '%caleb%blanco%';

-- PASO 2: Buscar sus pedidos de almuerzo de marzo 2026
SELECT 
  lo.id,
  lo.order_date,
  lo.created_at,
  lo.status,
  lo.is_cancelled,
  lo.payment_method,
  lo.school_id,
  lo.student_id,
  lo.final_price,
  lo.category_id,
  lc.name AS category_name
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lo.category_id = lc.id
WHERE lo.student_id = (
  SELECT id FROM students WHERE full_name ILIKE '%caleb%blanco%' LIMIT 1
)
AND lo.order_date >= '2026-03-01'
ORDER BY lo.order_date;

-- PASO 3: Buscar TODAS las transacciones de Caleb en marzo 2026
SELECT 
  t.id,
  t.type,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.description,
  t.is_deleted,
  t.created_at,
  t.school_id,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'source' AS source
FROM transactions t
WHERE t.student_id = (
  SELECT id FROM students WHERE full_name ILIKE '%caleb%blanco%' LIMIT 1
)
AND t.created_at >= '2026-03-01'
ORDER BY t.created_at DESC;

-- PASO 4: Buscar si el pedido del 2 de marzo tiene transacción vinculada
SELECT 
  t.id,
  t.payment_status,
  t.is_deleted,
  t.amount,
  t.description,
  t.school_id,
  t.student_id,
  t.metadata
FROM transactions t
WHERE t.metadata->>'lunch_order_id' = (
  SELECT lo.id::text 
  FROM lunch_orders lo
  WHERE lo.student_id = (SELECT id FROM students WHERE full_name ILIKE '%caleb%blanco%' LIMIT 1)
  AND lo.order_date = '2026-03-02'
  LIMIT 1
);
