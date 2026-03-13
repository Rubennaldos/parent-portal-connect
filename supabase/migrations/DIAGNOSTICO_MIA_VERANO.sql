-- =====================================================================
-- DIAGNÓSTICO: Mia Verano Francia — T-ME2-000007 pendiente
-- =====================================================================
-- Ejecutar en Supabase SQL Editor para entender el caso completo

-- 1. Buscar el estudiante
SELECT 
  id, 
  full_name, 
  balance,
  school_id,
  free_account,
  parent_id
FROM students 
WHERE full_name ILIKE '%mia verano%' 
   OR full_name ILIKE '%verano francia%';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Ver TODAS las transacciones de Mia (reemplaza el ID del paso 1)
-- ─────────────────────────────────────────────────────────────────────
SELECT 
  t.id,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_lima,
  t.type,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.ticket_code,
  t.description,
  t.is_deleted,
  t.metadata
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE s.full_name ILIKE '%mia verano%'
ORDER BY t.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Ver el pedido de almuerzo específico (T-ME2-000007)
-- ─────────────────────────────────────────────────────────────────────
SELECT 
  t.id AS transaction_id,
  t.ticket_code,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha,
  t.description,
  t.metadata,
  lo.id AS lunch_order_id,
  lo.is_cancelled,
  lo.status AS lunch_status,
  lo.lunch_date
FROM transactions t
LEFT JOIN lunch_orders lo ON lo.id = (t.metadata->>'lunch_order_id')::uuid
WHERE t.ticket_code = 'T-ME2-000007';

-- ─────────────────────────────────────────────────────────────────────
-- 4. Ver TODOS los vouchers/recargas del padre de Mia
-- ─────────────────────────────────────────────────────────────────────
SELECT 
  rr.id,
  rr.created_at AT TIME ZONE 'America/Lima' AS fecha_lima,
  rr.amount,
  rr.status,
  rr.request_type,
  rr.description,
  rr.operation_number,
  rr.lunch_order_ids,
  rr.paid_transaction_ids,
  rr.approved_at AT TIME ZONE 'America/Lima' AS aprobado_en,
  rr.rejection_reason
FROM recharge_requests rr
JOIN students s ON rr.student_id = s.id
WHERE s.full_name ILIKE '%mia verano%'
ORDER BY rr.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Ver pedidos de almuerzo de toda la semana del 10 de marzo
-- ─────────────────────────────────────────────────────────────────────
SELECT 
  lo.id,
  lo.lunch_date,
  lo.status,
  lo.is_cancelled,
  lo.payment_method,
  lo.payment_status,
  lo.total_price,
  lo.created_at AT TIME ZONE 'America/Lima' AS pedido_creado
FROM lunch_orders lo
JOIN students s ON lo.student_id = s.id
WHERE s.full_name ILIKE '%mia verano%'
  AND lo.lunch_date BETWEEN '2026-03-09' AND '2026-03-14'
ORDER BY lo.lunch_date;
