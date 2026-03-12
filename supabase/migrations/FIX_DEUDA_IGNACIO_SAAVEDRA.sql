-- ============================================================
-- FIX: Cancelar T-NAT-000001 (S/15.00 Lunch Fast — creado por error)
-- Los tickets T-NAT-000002 al 000005 ya están PAGADOS ✅
-- ============================================================

-- PASO 1: Cancelar la transacción del Lunch Fast
UPDATE transactions
SET
  payment_status = 'cancelled',
  is_deleted     = true,
  metadata       = jsonb_set(
    COALESCE(metadata, '{}'),
    '{cancellation_reason}',
    '"Cancelado por error de sistema: botón Lunch Fast eliminado. Autorizado por administrador."'
  ) || jsonb_build_object('manual_fix', true, 'cancelled_at', NOW()::text)
WHERE id = '87f7b5b4-5dc5-4aff-af7f-c533a68fa300'  -- T-NAT-000001
  AND ticket_code = 'T-NAT-000001'
  AND payment_status = 'pending';

-- PASO 2: Si hay un lunch_order vinculado a esa transacción, cancelarlo también
UPDATE lunch_orders
SET
  is_cancelled         = true,
  status               = 'cancelled',
  cancellation_reason  = 'Cancelado por error de sistema: pedido generado por botón Lunch Fast eliminado.'
WHERE id IN (
  SELECT (metadata->>'lunch_order_id')::uuid
  FROM transactions
  WHERE id = '87f7b5b4-5dc5-4aff-af7f-c533a68fa300'
    AND metadata->>'lunch_order_id' IS NOT NULL
)
AND status NOT IN ('delivered', 'cancelled');

-- PASO 3: Devolver el saldo al alumno si se descontó
-- (Solo ejecutar si el saldo del alumno fue afectado — verificar primero)
-- UPDATE students SET balance = balance + 15.00
-- WHERE id = (SELECT student_id FROM transactions WHERE id = '87f7b5b4-5dc5-4aff-af7f-c533a68fa300');

-- PASO 4: VERIFICACIÓN FINAL — confirmar que ya no hay deuda pendiente
SELECT
  t.ticket_code,
  t.amount,
  t.payment_status,
  s.full_name AS alumno
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE s.full_name ILIKE '%saavedra%'
  AND t.type = 'purchase'
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
ORDER BY t.created_at ASC;
