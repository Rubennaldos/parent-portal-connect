-- ============================================================
-- FIX MASIVO: Transacciones huérfanas
-- Condición: recharge_request está 'approved' PERO la
-- transaction vinculada sigue en 'pending'
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- PASO 1: DIAGNÓSTICO — Ver cuántos casos hay antes de corregir
SELECT
  COUNT(*)                          AS total_huerfanas,
  SUM(ABS(t.amount))                AS monto_total_afectado
FROM transactions t
WHERE t.payment_status = 'pending'
  AND t.is_deleted = false
  AND t.type = 'purchase'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM recharge_requests rr
    WHERE rr.status = 'approved'
      AND rr.request_type IN ('lunch_payment', 'debt_payment')
      AND (
        rr.lunch_order_ids @> ARRAY[(t.metadata->>'lunch_order_id')::uuid]
        OR
        rr.paid_transaction_ids @> ARRAY[t.id]
      )
  );

-- PASO 2: VER EL DETALLE de cada caso (ejecutar solo si quieres revisar uno a uno)
SELECT
  t.id                              AS transaction_id,
  t.ticket_code,
  t.amount,
  t.created_at                      AS tx_fecha,
  t.metadata->>'lunch_order_id'     AS lunch_order_id,
  s.full_name                       AS alumno,
  rr.id                             AS voucher_id,
  rr.amount                         AS voucher_monto,
  rr.approved_at,
  p.email                           AS padre_email,
  p.full_name                       AS padre_nombre
FROM transactions t
LEFT JOIN students s ON s.id = t.student_id
LEFT JOIN LATERAL (
  SELECT rr.id, rr.amount, rr.approved_at, rr.parent_id
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.request_type IN ('lunch_payment', 'debt_payment')
    AND (
      rr.lunch_order_ids @> ARRAY[(t.metadata->>'lunch_order_id')::uuid]
      OR rr.paid_transaction_ids @> ARRAY[t.id]
    )
  LIMIT 1
) rr ON true
LEFT JOIN profiles p ON p.id = rr.parent_id
WHERE t.payment_status = 'pending'
  AND t.is_deleted = false
  AND t.type = 'purchase'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND rr.id IS NOT NULL
ORDER BY t.created_at DESC;

-- ============================================================
-- PASO 3: CORRECCIÓN MASIVA
-- Solo ejecutar después de revisar el paso 1 y 2
-- ============================================================

-- 3A: Marcar transacciones como pagadas
UPDATE transactions t
SET
  payment_status = 'paid',
  payment_method = COALESCE(
    (SELECT rr.payment_method FROM recharge_requests rr
     WHERE rr.status = 'approved'
       AND rr.request_type IN ('lunch_payment', 'debt_payment')
       AND (
         rr.lunch_order_ids @> ARRAY[(t.metadata->>'lunch_order_id')::uuid]
         OR rr.paid_transaction_ids @> ARRAY[t.id]
       )
     LIMIT 1),
    'voucher'
  ),
  metadata = t.metadata || jsonb_build_object(
    'fixed_bulk', true,
    'fix_reason', 'Voucher ya aprobado — tx quedó en pending por bug RLS recursiva',
    'fixed_at', NOW()::text
  )
WHERE t.payment_status = 'pending'
  AND t.is_deleted = false
  AND t.type = 'purchase'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM recharge_requests rr
    WHERE rr.status = 'approved'
      AND rr.request_type IN ('lunch_payment', 'debt_payment')
      AND (
        rr.lunch_order_ids @> ARRAY[(t.metadata->>'lunch_order_id')::uuid]
        OR rr.paid_transaction_ids @> ARRAY[t.id]
      )
  );

-- 3B: Confirmar los lunch_orders cuyas transacciones acaban de ser corregidas
UPDATE lunch_orders lo
SET status = 'confirmed'
WHERE lo.status = 'pending'
  AND lo.is_cancelled = false
  AND EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.metadata->>'lunch_order_id' = lo.id::text
      AND t.payment_status = 'paid'
      AND t.is_deleted = false
      AND (t.metadata->>'fixed_bulk')::boolean = true
  );

-- VERIFICACIÓN FINAL: debe devolver 0 huérfanas
SELECT
  COUNT(*) AS huerfanas_restantes
FROM transactions t
WHERE t.payment_status = 'pending'
  AND t.is_deleted = false
  AND t.type = 'purchase'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM recharge_requests rr
    WHERE rr.status = 'approved'
      AND rr.request_type IN ('lunch_payment', 'debt_payment')
      AND (
        rr.lunch_order_ids @> ARRAY[(t.metadata->>'lunch_order_id')::uuid]
        OR rr.paid_transaction_ids @> ARRAY[t.id]
      )
  );
