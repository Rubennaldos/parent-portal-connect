-- ============================================================
-- DIAGNÓSTICO: Por qué aparece "Pago en revisión" en el pedido
-- de Almudena Ugaz Hernandez (T-MAR17-000001)
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- PASO 1: Encontrar el pedido de Almudena
SELECT 
  lo.id              AS lunch_order_id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.payment_method,
  lo.created_at,
  s.full_name        AS alumno
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
WHERE s.full_name ILIKE '%almudena%ugaz%'
  AND lo.order_date >= '2026-03-01'
ORDER BY lo.created_at DESC
LIMIT 10;

-- ============================================================
-- PASO 2: Buscar transacciones vinculadas a ese pedido
-- (esto es lo que activa el "Pago en revisión")
-- ============================================================
SELECT 
  t.id                        AS transaction_id,
  t.ticket_code,
  t.payment_status,
  t.payment_method,
  t.amount,
  t.created_at,
  t.metadata->>'lunch_order_id' AS lunch_order_id_en_metadata,
  t.is_deleted
FROM transactions t
WHERE t.metadata->>'lunch_order_id' IN (
  SELECT lo.id::text
  FROM lunch_orders lo
  JOIN students s ON s.id = lo.student_id
  WHERE s.full_name ILIKE '%almudena%ugaz%'
    AND lo.order_date >= '2026-03-01'
)
ORDER BY t.created_at DESC;

-- ============================================================
-- PASO 3: Buscar vouchers (recharge_requests) del padre de Almudena
-- ============================================================
SELECT 
  rr.id,
  rr.status,
  rr.amount,
  rr.created_at,
  rr.reference_code,
  rr.request_type,
  p.email              AS padre_email,
  p.full_name          AS padre_nombre
FROM recharge_requests rr
JOIN profiles p ON p.id = rr.parent_id
WHERE rr.parent_id IN (
  SELECT s.parent_id 
  FROM students s 
  WHERE s.full_name ILIKE '%almudena%ugaz%'
)
ORDER BY rr.created_at DESC
LIMIT 10;
