-- ═══════════════════════════════════════════════════════════════════════════
-- REPAIR: Transacciones 'pending' con voucher aprobado pero sin actualizar
--
-- Escenario A (causa principal — datos históricos):
--   El admin aprobó vouchers ANTES de que existiera el RPC atómico
--   (process_traditional_voucher_approval, creado 2026-04-05). El código
--   antiguo solo actualizaba recharge_requests.status='approved' sin tocar
--   transactions.payment_status. Las transacciones quedaron 'pending'.
--
-- Escenario B (bug en curso — split payment):
--   La ruta de pago dividido actualiza recharge_requests ANTES de llamar
--   al RPC. Si el RPC falla, el voucher queda 'approved' pero las
--   transacciones siguen 'pending'.
--
-- Esta migración busca todas las transacciones en ese estado y las repara.
-- Es IDEMPOTENTE: si se corre dos veces, el segundo UPDATE no toca nada
-- porque ya no habrá transacciones con payment_status IN ('pending','partial')
-- que estén referenciadas por vouchers aprobados.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count_a integer := 0;
  v_count_b integer := 0;
  v_count_c integer := 0;
BEGIN

  -- ── Fuente A: transactions referenciadas en paid_transaction_ids ──────────
  -- Estos son pagos de deuda (debt_payment) o de almuerzo (lunch_payment) donde
  -- el padre envió el voucher con los IDs explícitos de las transacciones.
  WITH orphaned_a AS (
    SELECT DISTINCT
      unnest(rr.paid_transaction_ids)::uuid AS tx_id,
      rr.id                                  AS voucher_id,
      rr.payment_method,
      rr.reference_code,
      rr.approved_by,
      rr.approved_at,
      rr.voucher_url,
      rr.request_type
    FROM recharge_requests rr
    WHERE rr.status       = 'approved'
      AND rr.paid_transaction_ids IS NOT NULL
      AND array_length(rr.paid_transaction_ids, 1) > 0
      AND rr.request_type IN ('lunch_payment', 'debt_payment')
  )
  UPDATE transactions t
  SET
    payment_status = 'paid',
    payment_method = COALESCE(t.payment_method, o.payment_method),
    metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
      'payment_approved',      true,
      'payment_source',        'repair_orphaned_' || o.request_type,
      'recharge_request_id',   o.voucher_id::text,
      'reference_code',        o.reference_code,
      'approved_by',           o.approved_by::text,
      'approved_at',           COALESCE(o.approved_at::text, NOW()::text),
      'voucher_url',           o.voucher_url,
      'repair_applied_at',     NOW()::text,
      'last_payment_rejected', false
    )
  FROM orphaned_a o
  WHERE t.id             = o.tx_id
    AND t.payment_status IN ('pending', 'partial')
    AND t.is_deleted     = false;

  GET DIAGNOSTICS v_count_a = ROW_COUNT;

  -- ── Fuente B: transactions vinculadas a lunch_order_ids por metadata JSONB ─
  -- Para pagos de almuerzo donde la vinculación es por lunch_order_id en metadata.
  UPDATE transactions t
  SET
    payment_status = 'paid',
    payment_method = COALESCE(t.payment_method, rr.payment_method),
    metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
      'payment_approved',      true,
      'payment_source',        'repair_orphaned_lunch_payment',
      'recharge_request_id',   rr.id::text,
      'reference_code',        rr.reference_code,
      'approved_by',           rr.approved_by::text,
      'approved_at',           COALESCE(rr.approved_at::text, NOW()::text),
      'voucher_url',           rr.voucher_url,
      'repair_applied_at',     NOW()::text,
      'last_payment_rejected', false
    )
  FROM recharge_requests rr
  WHERE rr.status       = 'approved'
    AND rr.request_type = 'lunch_payment'
    AND rr.lunch_order_ids IS NOT NULL
    AND array_length(rr.lunch_order_ids, 1) > 0
    AND (t.metadata->>'lunch_order_id')::uuid = ANY(rr.lunch_order_ids)
    AND t.type           = 'purchase'
    AND t.payment_status IN ('pending', 'partial')
    AND t.is_deleted     = false;

  GET DIAGNOSTICS v_count_b = ROW_COUNT;

  -- ── Fuente C: confirmar lunch_orders activos de vouchers aprobados ─────────
  -- Sincronizar lunch_orders.status = 'confirmed' para órdenes cuyo
  -- pago fue aprobado pero el status no se actualizó (mismo escenario).
  UPDATE lunch_orders lo
  SET    status = 'confirmed'
  FROM   recharge_requests rr
  WHERE  rr.status       = 'approved'
    AND  rr.request_type = 'lunch_payment'
    AND  rr.lunch_order_ids IS NOT NULL
    AND  array_length(rr.lunch_order_ids, 1) > 0
    AND  lo.id           = ANY(rr.lunch_order_ids)
    AND  lo.is_cancelled = false
    AND  lo.status      <> 'confirmed'
    AND  lo.status      <> 'cancelled';

  GET DIAGNOSTICS v_count_c = ROW_COUNT;

  RAISE NOTICE
    'Reparación completada: '
    '% tx reparadas (Fuente A: paid_transaction_ids), '
    '% tx reparadas (Fuente B: lunch_order_ids metadata), '
    '% lunch_orders confirmados (Fuente C).',
    v_count_a, v_count_b, v_count_c;

END;
$$;

-- ── Verificación post-reparación ──────────────────────────────────────────────
-- Muestra cuántas transacciones siguen huérfanas DESPUÉS de la reparación.
-- Debería retornar 0 filas si el script funcionó correctamente.
SELECT
  rr.id                    AS voucher_id,
  rr.request_type,
  rr.status                AS voucher_status,
  rr.amount,
  rr.approved_at,
  t.id                     AS transaction_id,
  t.payment_status         AS tx_status,
  t.amount                 AS tx_amount
FROM recharge_requests rr
JOIN LATERAL (
  SELECT id, payment_status, amount
  FROM   transactions
  WHERE  id = ANY(rr.paid_transaction_ids)
    AND  payment_status IN ('pending', 'partial')
    AND  is_deleted = false
  LIMIT 5
) t ON true
WHERE rr.status       = 'approved'
  AND rr.request_type IN ('lunch_payment', 'debt_payment')
  AND rr.paid_transaction_ids IS NOT NULL
  AND array_length(rr.paid_transaction_ids, 1) > 0
ORDER BY rr.approved_at DESC
LIMIT 20;
