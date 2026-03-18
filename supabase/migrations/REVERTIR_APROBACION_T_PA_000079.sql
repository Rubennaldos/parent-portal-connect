-- ============================================================
-- REVERTIR APROBACIÓN ACCIDENTAL — Ticket T-PA-000079 / Nº Operación 12345677
-- Pago de deuda S/ 13 — hijo prueba mc1 — padremc1@gmail.com
-- Aprobado por error por matiasmc1@limacafe28.com
--
-- 1. Transacción → payment_status = 'pending'
-- 2. Voucher (recharge_requests) → status = 'rejected'
-- 3. lunch_order vinculada → status = 'pending'
-- NO toca students.balance (Regla #3)
-- ============================================================

-- OPCIÓN A: Solo diagnóstico (ejecutar primero y revisar)
SELECT
  t.id AS tx_id,
  t.ticket_code,
  t.operation_number,
  t.amount,
  t.payment_status,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
WHERE (t.operation_number = '12345677' OR t.ticket_code = 'T-PA-000079')
  AND t.payment_status = 'paid';

-- OPCIÓN B: Revertir todo en un solo bloque (ejecutar después de revisar OPCIÓN A)
DO $$
DECLARE
  v_tx_id uuid;
  v_order_id text;
  v_req_id uuid;
BEGIN
  SELECT t.id, t.metadata->>'lunch_order_id'
  INTO v_tx_id, v_order_id
  FROM transactions t
  WHERE (t.operation_number = '12345677' OR t.ticket_code = 'T-PA-000079')
    AND t.payment_status = 'paid'
  LIMIT 1;

  IF v_tx_id IS NULL THEN
    RAISE NOTICE 'No se encontró transacción con operation_number 12345677 o ticket T-PA-000079 (o ya está pendiente).';
    RETURN;
  END IF;

  UPDATE transactions
  SET payment_status = 'pending', payment_method = NULL
  WHERE id = v_tx_id;
  RAISE NOTICE 'Transacción % revertida a pendiente.', v_tx_id;

  SELECT rr.id INTO v_req_id
  FROM recharge_requests rr
  WHERE rr.status = 'approved'
    AND rr.paid_transaction_ids @> ARRAY[v_tx_id]
  LIMIT 1;

  IF v_req_id IS NOT NULL THEN
    UPDATE recharge_requests
    SET status = 'rejected',
        approved_by = NULL,
        approved_at = NULL,
        rejection_reason = 'Revertido: aprobado por error. Solicitud del administrador.'
    WHERE id = v_req_id;
    RAISE NOTICE 'Voucher % marcado como rechazado.', v_req_id;
  ELSE
    RAISE NOTICE 'No se encontró recharge_request aprobado con esta transacción (puede estar en lunch_order_ids). Buscar manualmente si hace falta.';
  END IF;

  IF v_order_id IS NOT NULL AND trim(v_order_id) != '' THEN
    UPDATE lunch_orders
    SET status = 'pending'
    WHERE id = v_order_id::uuid AND status = 'confirmed';
    RAISE NOTICE 'Orden de almuerzo % vuelta a pendiente.', v_order_id;
  END IF;
END $$;
