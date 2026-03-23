-- ============================================================
-- DIAGNÓSTICO: Padre bloqueado — Alessandra Díaz Ridia
-- El padre tiene "1 pedido pendiente" y no puede enviar voucher
-- ============================================================

-- PASO 1: Buscar al padre por nombre del alumno
SELECT
  p.id            AS parent_id,
  p.email         AS padre_email,
  p.full_name     AS padre_nombre,
  s.id            AS student_id,
  s.full_name     AS alumno,
  s.school_id
FROM students s
JOIN profiles p ON p.id = s.parent_id
WHERE s.full_name ILIKE '%Alessandra%Díaz%'
   OR s.full_name ILIKE '%Alessandra%Diaz%'
   OR s.full_name ILIKE '%Alessandra%Ridia%';

-- PASO 2: Ver sus recharge_requests pendientes
-- (reemplazar el parent_id con el del PASO 1 si es necesario)
SELECT
  rr.id,
  rr.status,
  rr.request_type,
  rr.amount,
  rr.created_at,
  rr.lunch_order_ids,
  rr.reference_code,
  rr.rejection_reason
FROM recharge_requests rr
JOIN students s ON s.id = rr.student_id
WHERE s.full_name ILIKE '%Alessandra%'
ORDER BY rr.created_at DESC
LIMIT 20;

-- PASO 3: Ver sus lunch_orders pendientes
SELECT
  lo.id,
  lo.status,
  lo.order_date,
  lo.is_cancelled,
  cat.name AS categoria
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
LEFT JOIN lunch_categories cat ON cat.id = lo.category_id
WHERE s.full_name ILIKE '%Alessandra%'
  AND lo.status = 'pending'
  AND lo.is_cancelled = false
ORDER BY lo.order_date DESC;

-- PASO 4: Ver transacciones pendientes vinculadas a almuerzos
SELECT
  t.id,
  t.payment_status,
  t.amount,
  t.created_at,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE s.full_name ILIKE '%Alessandra%'
  AND t.payment_status = 'pending'
  AND t.type = 'purchase'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
ORDER BY t.created_at DESC;
