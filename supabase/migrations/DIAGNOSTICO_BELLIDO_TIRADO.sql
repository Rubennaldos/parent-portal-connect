-- =====================================================================
-- DIAGNÓSTICO: MATEO BENJAMIN Y PIERO ALESSANDRO BELLIDO TIRADO
-- Objetivo: Detectar por qué el padre ve "pagado" en pedidos
--           pero "deuda" en la pestaña de pagos (y viceversa).
-- Ejecutar en Supabase SQL Editor (solo lectura, no modifica nada).
-- =====================================================================

-- ─── PASO 1: Encontrar los estudiantes ───────────────────────────────
SELECT
  id,
  full_name,
  free_account,
  balance,
  kiosk_disabled,
  is_active,
  school_id
FROM students
WHERE full_name ILIKE '%Bellido%Tirado%'
   OR full_name ILIKE '%Mateo%Bellido%'
   OR full_name ILIKE '%Piero%Bellido%'
ORDER BY full_name;

-- ─── PASO 2: Transacciones de almuerzo PENDIENTES (las que generan deuda) ───
-- Si aparecen aquí, la pestaña "Pagos" del padre los contará como deuda
SELECT
  t.id           AS transaction_id,
  s.full_name    AS alumno,
  t.amount,
  t.payment_status,
  t.description,
  t.created_at,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'payment_method' AS metodo_pago_metadata,
  t.payment_method,
  t.ticket_code
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE s.full_name ILIKE '%Bellido%Tirado%'
  AND t.type = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND t.is_deleted = false
ORDER BY t.created_at DESC;

-- ─── PASO 3: TODAS las transacciones de almuerzo (para detectar duplicados) ───
-- Si hay 2 filas con el mismo lunch_order_id: eso es el problema
SELECT
  t.id           AS transaction_id,
  s.full_name    AS alumno,
  t.amount,
  t.payment_status,
  t.description,
  t.created_at,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.payment_method,
  t.ticket_code,
  t.is_deleted
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE s.full_name ILIKE '%Bellido%Tirado%'
  AND t.type = 'purchase'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
ORDER BY t.metadata->>'lunch_order_id', t.created_at DESC;

-- ─── PASO 4: Pedidos de almuerzo de los últimos 60 días ─────────────
SELECT
  lo.id          AS order_id,
  s.full_name    AS alumno,
  lo.order_date,
  lo.status      AS estado_pedido,
  lo.created_at,
  lo.registered_by_type,
  lo.payment_method AS metodo_en_pedido
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
WHERE s.full_name ILIKE '%Bellido%Tirado%'
  AND lo.is_cancelled = false
  AND lo.order_date >= CURRENT_DATE - INTERVAL '60 days'
ORDER BY lo.order_date DESC, lo.created_at DESC;

-- ─── PASO 5: Vouchers enviados por el padre (recharge_requests) ──────
-- Muestra si hay pagos pendientes de aprobación o rechazados
SELECT
  rr.id,
  s.full_name    AS alumno,
  rr.request_type,
  rr.status,
  rr.amount,
  rr.created_at,
  rr.rejection_reason,
  rr.lunch_order_ids,
  rr.paid_transaction_ids
FROM recharge_requests rr
JOIN students s ON s.id = rr.student_id
WHERE s.full_name ILIKE '%Bellido%Tirado%'
  AND rr.request_type IN ('lunch_payment', 'debt_payment', 'recharge')
ORDER BY rr.created_at DESC
LIMIT 20;

-- ─── PASO 6: RESUMEN DEL PROBLEMA ────────────────────────────────────
-- Pedidos con su transacción asociada y estado de pago (vista completa)
SELECT
  lo.id                                         AS order_id,
  s.full_name                                   AS alumno,
  lo.order_date,
  lo.status                                     AS estado_pedido,
  t.id                                          AS transaction_id,
  t.payment_status                              AS estado_pago_transaccion,
  t.payment_method                              AS metodo_pago_transaccion,
  t.amount,
  t.ticket_code,
  t.is_deleted,
  COUNT(t2.id) OVER (
    PARTITION BY lo.id
  )                                             AS num_transacciones_por_pedido
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
LEFT JOIN transactions t
  ON t.metadata->>'lunch_order_id' = lo.id::text
  AND t.type = 'purchase'
  AND t.is_deleted = false
LEFT JOIN transactions t2
  ON t2.metadata->>'lunch_order_id' = lo.id::text
  AND t2.type = 'purchase'
  AND t2.is_deleted = false
WHERE s.full_name ILIKE '%Bellido%Tirado%'
  AND lo.is_cancelled = false
  AND lo.order_date >= CURRENT_DATE - INTERVAL '60 days'
ORDER BY lo.order_date DESC, lo.id, t.created_at DESC;
