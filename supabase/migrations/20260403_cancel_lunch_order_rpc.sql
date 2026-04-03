-- ════════════════════════════════════════════════════════════════════════════
-- RPC: cancel_lunch_order
-- Cancela un pedido de almuerzo y su transacción vinculada de forma ATÓMICA.
--
-- Reglas de negocio:
--   1. Si la transacción ya está 'paid' Y billing_status='pending' (no boleteada):
--      → se cancela el pedido Y la transacción (recupera el dinero contablemente).
--   2. Si la transacción ya fue boleteada (billing_status='sent'):
--      → se cancela SOLO el pedido. La transacción NO se toca (ya está en SUNAT).
--      → devuelve un aviso para que el admin emita nota de crédito.
--   3. Si la transacción estaba 'pending' (deuda no pagada):
--      → se cancela todo normalmente.
--   4. Si no hay transacción vinculada:
--      → se cancela solo el pedido (caso almuerzo sin transacción, entregado sin pago).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cancel_lunch_order(
  p_order_id    UUID,
  p_cancelled_by UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id             UUID;
  v_tx_payment_status TEXT;
  v_tx_billing_status TEXT;
  v_result            JSON;
  v_tx_cancelled      BOOLEAN := false;
  v_already_billed    BOOLEAN := false;
BEGIN

  -- ── Paso 1: Verificar que el pedido existe y no está ya cancelado ────────
  IF NOT EXISTS (
    SELECT 1 FROM lunch_orders
    WHERE id = p_order_id
      AND is_cancelled = false
      AND status <> 'cancelled'
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'El pedido no existe o ya fue cancelado.'
    );
  END IF;

  -- ── Paso 2: Buscar la transacción vinculada ──────────────────────────────
  SELECT id, payment_status, billing_status
  INTO v_tx_id, v_tx_payment_status, v_tx_billing_status
  FROM transactions
  WHERE metadata->>'lunch_order_id' = p_order_id::text
    AND is_deleted = false
  ORDER BY created_at DESC
  LIMIT 1;

  -- ── Paso 3: Decidir qué hacer con la transacción ─────────────────────────
  IF v_tx_id IS NOT NULL THEN
    IF v_tx_billing_status = 'sent' THEN
      -- Ya está en SUNAT: NO tocar la transacción → el admin debe hacer nota de crédito
      v_already_billed := true;
    ELSE
      -- Aún no boleteada → cancelar la transacción independientemente de si es paid/pending
      UPDATE transactions
      SET
        payment_status = 'cancelled',
        metadata = metadata || jsonb_build_object(
          'cancelled_at',     now()::text,
          'cancelled_by',     p_cancelled_by::text,
          'cancel_reason',    'Pedido de almuerzo anulado por padre/tutor'
        )
      WHERE id = v_tx_id;

      v_tx_cancelled := true;
    END IF;
  END IF;

  -- ── Paso 4: Cancelar el pedido (siempre, en ambos casos) ─────────────────
  UPDATE lunch_orders
  SET
    is_cancelled       = true,
    status             = 'cancelled',
    cancelled_by       = p_cancelled_by,
    cancelled_at       = now(),
    cancellation_reason = CASE
      WHEN v_already_billed
      THEN 'Anulado por padre/tutor — transacción ya boleteada en SUNAT (requiere nota de crédito)'
      ELSE 'Anulado por padre/tutor'
    END
  WHERE id = p_order_id;

  -- ── Paso 5: Devolver resultado con contexto para el frontend ─────────────
  RETURN json_build_object(
    'success',          true,
    'order_cancelled',  true,
    'tx_cancelled',     v_tx_cancelled,
    'already_billed',   v_already_billed,
    'tx_id',            v_tx_id
  );

END;
$$;

-- Permitir que el rol authenticated llame a este RPC
GRANT EXECUTE ON FUNCTION cancel_lunch_order(UUID, UUID) TO authenticated;
