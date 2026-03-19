-- ============================================================
-- FIX: Transacción huérfana de Almudena Ugaz Hernandez
-- El voucher fue aprobado (recharge_request 2cd45cbe) pero
-- la transacción T-MAR17-000001 quedó en 'pending'.
-- También se confirma el lunch_order.
-- ============================================================

-- VERIFICACIÓN PREVIA (ejecutar primero para confirmar)
SELECT 
  t.id, t.ticket_code, t.payment_status, t.amount, t.created_at,
  lo.status AS order_status
FROM transactions t
JOIN lunch_orders lo ON lo.id = (t.metadata->>'lunch_order_id')::uuid
WHERE t.id = 'd69eac8b-4f3d-49fd-b060-03f8888168c1';

-- ============================================================
-- CORRECCIÓN: marcar la transacción como pagada
-- y confirmar el pedido de almuerzo
-- ============================================================

-- 1. Marcar transacción como pagada
UPDATE transactions
SET 
  payment_status  = 'paid',
  payment_method  = 'voucher',
  metadata        = metadata || jsonb_build_object(
    'fixed_manually', true,
    'fix_reason', 'Voucher 2cd45cbe ya aprobado — transacción quedó en pending por error',
    'fixed_at', NOW()::text
  )
WHERE id = 'd69eac8b-4f3d-49fd-b060-03f8888168c1'
  AND payment_status = 'pending';

-- 2. Confirmar el pedido de almuerzo
UPDATE lunch_orders
SET status = 'confirmed'
WHERE id = '7d573012-a2b9-4e10-a77a-f6903a9014d9'
  AND status = 'pending'
  AND is_cancelled = false;

-- VERIFICACIÓN FINAL
SELECT 
  t.id, t.ticket_code, t.payment_status,
  lo.status AS order_status
FROM transactions t
JOIN lunch_orders lo ON lo.id = (t.metadata->>'lunch_order_id')::uuid
WHERE t.id = 'd69eac8b-4f3d-49fd-b060-03f8888168c1';
