-- =====================================================================
-- DIAGNÓSTICO: Valentina Arellano Adrianzén — deuda S/93.50
-- BCP transferencia del 07/mar/2026, op. 06037334
-- =====================================================================

-- 1. Buscar la alumna
SELECT 
  id, 
  full_name, 
  balance,
  school_id,
  free_account,
  parent_id
FROM students 
WHERE full_name ILIKE '%valentina arellano%'
   OR full_name ILIKE '%arellano adrianzen%'
   OR full_name ILIKE '%arellano%adrianz%';

-- 2. Todas sus transacciones
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
  t.metadata->>'reference_code' AS num_operacion,
  t.metadata->>'approved_at' AS aprobado_en
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE s.full_name ILIKE '%valentina arellano%'
ORDER BY t.created_at DESC;

-- 3. Todos sus vouchers/recargas
SELECT 
  rr.id,
  rr.created_at AT TIME ZONE 'America/Lima' AS subido_el,
  rr.approved_at AT TIME ZONE 'America/Lima' AS aprobado_el,
  rr.amount,
  rr.status,
  rr.request_type,
  rr.description,
  rr.lunch_order_ids,
  rr.paid_transaction_ids,
  rr.voucher_url
FROM recharge_requests rr
JOIN students s ON rr.student_id = s.id
WHERE s.full_name ILIKE '%valentina arellano%'
ORDER BY rr.created_at DESC;

-- 4. Buscar por número de operación BCP en metadata
SELECT 
  t.id,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha,
  t.amount,
  t.payment_status,
  t.ticket_code,
  t.description,
  s.full_name AS alumno,
  t.metadata
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE t.metadata::text ILIKE '%06037334%';

-- 5. Resumen de deudas pendientes de Valentina
SELECT 
  payment_status,
  COUNT(*) AS cantidad,
  SUM(ABS(amount)) AS total
FROM transactions t
JOIN students s ON t.student_id = s.id
WHERE s.full_name ILIKE '%valentina arellano%'
  AND t.is_deleted = false
  AND t.type = 'purchase'
GROUP BY payment_status;
