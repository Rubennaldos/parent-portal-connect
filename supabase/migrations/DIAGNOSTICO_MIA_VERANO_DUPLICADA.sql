-- =====================================================================
-- DIAGNÓSTICO: Cuenta DUPLICADA de Mia Verano Francia
-- Hay 2 registros en students para la misma alumna:
--   1. edaf1c8f → "Mia Verano Franci"  (free_account=false, balance=0)
--   2. a24146ba → "Mia Verano Francia"  (free_account=true, balance=-112)
-- =====================================================================

-- 1. Ver transacciones de AMBAS cuentas
SELECT 
  s.id AS student_id,
  s.full_name,
  s.free_account,
  s.balance,
  t.id AS tx_id,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha,
  t.type,
  t.amount,
  t.payment_status,
  t.payment_method,
  t.ticket_code,
  t.description,
  t.is_deleted
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id
WHERE s.id IN (
  'edaf1c8f-20e6-4c3e-a5db-9fbbd9cb7135',  -- Mia Verano Franci (sin a)
  'a24146ba-0f14-4af9-9ca6-74fde859cec0'   -- Mia Verano Francia
)
ORDER BY s.full_name, t.created_at DESC;

-- 2. Ver pedidos de almuerzo de AMBAS cuentas
SELECT 
  s.full_name,
  lo.id AS lunch_order_id,
  lo.lunch_date,
  lo.status,
  lo.is_cancelled,
  lo.payment_method,
  lo.payment_status,
  lo.total_price,
  lo.created_at AT TIME ZONE 'America/Lima' AS pedido_creado
FROM lunch_orders lo
JOIN students s ON lo.student_id = s.id
WHERE s.id IN (
  'edaf1c8f-20e6-4c3e-a5db-9fbbd9cb7135',
  'a24146ba-0f14-4af9-9ca6-74fde859cec0'
)
ORDER BY lo.lunch_date DESC;

-- 3. Ver vouchers de AMBAS cuentas
SELECT 
  s.full_name,
  rr.id,
  rr.amount,
  rr.status,
  rr.request_type,
  rr.operation_number,
  rr.created_at AT TIME ZONE 'America/Lima' AS fecha,
  rr.lunch_order_ids,
  rr.paid_transaction_ids
FROM recharge_requests rr
JOIN students s ON rr.student_id = s.id
WHERE s.id IN (
  'edaf1c8f-20e6-4c3e-a5db-9fbbd9cb7135',
  'a24146ba-0f14-4af9-9ca6-74fde859cec0'
)
ORDER BY rr.created_at DESC;

-- =====================================================================
-- RESUMEN DEL CASO:
-- 
-- La mamá pagó S/80 el 27/feb (Scotiabank, op. 784.465.193.6891)
-- Ese pago cubrió 5 pedidos: 9, 11, 12, 13 marzo (4 días = S/64)
-- Hay 1 cancelada del 9/mar (duplicada)
-- 
-- El pedido del 10/MAR (T-ME2-000007, S/16) se creó el 10/03 08:11
-- DESPUÉS de que el voucher fue aprobado el 27/feb 18:18
-- → NO estaba incluido en el pago de S/80
--
-- ADEMÁS: La alumna tiene balance de -S/112 en la cuenta free_account
-- Esto indica más deudas acumuladas que no se han pagado
-- =====================================================================
