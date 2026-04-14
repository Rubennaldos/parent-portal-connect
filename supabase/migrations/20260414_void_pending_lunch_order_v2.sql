-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: void_pending_lunch_order_v2
-- Fecha: 2026-04-14
--
-- PROPÓSITO:
--   Resuelve el "deadlock de UX": el padre no podía anular un pedido de almuerzo
--   cuando su comprobante (recharge_request) estaba en estado pending.
--
-- CAMBIOS:
--   A. Índice único parcial en reference_code ahora excluye TAMBIÉN 'voided'
--      → el padre puede reutilizar el mismo número de operación tras la anulación.
--
--   B. Función void_pending_lunch_order_v2(p_order_id UUID, p_parent_id UUID)
--      Anula atómicamente:
--        1. El lunch_order (status → 'cancelled', is_cancelled → true)
--        2. El recharge_request pending vinculado (status → 'voided')
--        3. La transacción pendiente del pedido (payment_status → 'cancelled')
--        4. Registra en huella_digital_logs (best-effort)
--
-- RESTRICCIONES GARANTIZADAS:
--   - NUNCA borra registros (Audit Trail intacto)
--   - Solo opera sobre pedidos con recharge_request EN ESTADO pending
--   - Si el voucher cubre múltiples pedidos a la vez, RECHAZA la operación
--     para no afectar otros pedidos del mismo comprobante
--   - FOR UPDATE en ambas tablas previene doble anulación concurrente
-- ══════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE A: Actualizar el índice único de reference_code
--           El índice anterior excluía solo 'rejected'.
--           Ahora también excluye 'voided' para que el padre pueda reutilizar
--           el mismo número de operación después de una anulación.
-- ════════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_recharge_unique_ref_code;

CREATE UNIQUE INDEX idx_recharge_unique_ref_code
  ON recharge_requests(reference_code, school_id)
  WHERE status NOT IN ('rejected', 'voided')
    AND reference_code IS NOT NULL
    AND reference_code != '';

COMMENT ON INDEX idx_recharge_unique_ref_code IS
  'Índice único parcial: previene duplicados de reference_code por sede,
   excepto para registros rechazados (rejected) o anulados (voided).
   Esto permite al padre reutilizar el mismo número de operación tras anular.';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE B: Función void_pending_lunch_order_v2
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS void_pending_lunch_order_v2(uuid, uuid);

CREATE OR REPLACE FUNCTION void_pending_lunch_order_v2(
  p_order_id   UUID,
  p_parent_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order       RECORD;
  v_rr          RECORD;
  v_tx_id       UUID;
  v_school_id   UUID;
BEGIN

  -- ── PASO 1: Bloquear y verificar el pedido ──────────────────────────────
  -- FOR UPDATE OF lo bloquea SOLO la fila de lunch_orders.
  -- Evitamos el lock innecesario sobre students (que se actualiza frecuentemente
  -- por el POS/kiosco) para prevenir contención bajo carga concurrente.
  SELECT lo.*, s.school_id AS school_id
  INTO   v_order
  FROM   lunch_orders lo
  JOIN   students s ON s.id = lo.student_id
  WHERE  lo.id = p_order_id
  FOR UPDATE OF lo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: El pedido % no existe.', p_order_id;
  END IF;

  IF v_order.is_cancelled OR v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_ALREADY_CANCELLED: El pedido ya fue cancelado anteriormente.';
  END IF;

  IF v_order.status = 'delivered' THEN
    RAISE EXCEPTION 'ORDER_DELIVERED: No se puede anular un pedido que ya fue entregado.';
  END IF;

  v_school_id := v_order.school_id;

  -- ── PASO 2: Buscar el recharge_request pending vinculado a este pedido ──
  -- Nota: recharge_requests.lunch_order_ids es un array UUID[].
  -- FOR UPDATE previene doble aprobación/anulación concurrente del voucher.
  SELECT *
  INTO   v_rr
  FROM   recharge_requests
  WHERE  p_order_id = ANY(COALESCE(lunch_order_ids, '{}'))
    AND  status     = 'pending'
  ORDER BY created_at DESC
  LIMIT  1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_PENDING_VOUCHER: No se encontró un comprobante pendiente (recharge_request) para este pedido. Usa la anulación normal si el pedido no tiene comprobante enviado.';
  END IF;

  -- ── PASO 3: Guardia anti-multi-pedido ───────────────────────────────────
  -- Si el voucher cubre más de un pedido, la anulación completa del voucher
  -- podría perjudicar los otros pedidos → rechazar y derivar a admin.
  IF COALESCE(cardinality(v_rr.lunch_order_ids), 0) > 1 THEN
    RAISE EXCEPTION 'MULTI_ORDER_VOUCHER: El comprobante cubre % pedidos en total. Para evitar afectar los demás pedidos, comunícate con administración para anularlo manualmente.',
      cardinality(v_rr.lunch_order_ids);
  END IF;

  -- ── PASO 4: Invalidar el comprobante (recharge_request → voided) ────────
  -- Usamos los campos de auditoría agregados en 20260413_void_payment_rpc.sql.
  -- p_parent_id actúa como "voided_by" ya que es el padre quien inicia la acción.
  UPDATE recharge_requests
  SET
    status      = 'voided',
    voided_by   = p_parent_id,
    voided_at   = NOW(),
    void_reason = 'Anulado por padre/tutor al cancelar el pedido de almuerzo'
  WHERE id = v_rr.id;

  -- ── PASO 5: Cancelar la transacción vinculada al pedido (si existe) ─────
  SELECT id
  INTO   v_tx_id
  FROM   transactions
  WHERE  metadata->>'lunch_order_id' = p_order_id::text
    AND  is_deleted = false
    AND  payment_status NOT IN ('cancelled', 'paid')
  ORDER BY created_at DESC
  LIMIT  1;

  IF v_tx_id IS NOT NULL THEN
    UPDATE transactions
    SET
      payment_status = 'cancelled',
      metadata = COALESCE(metadata, '{}') || jsonb_build_object(
        'cancelled_at',     to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'cancelled_by',     p_parent_id::text,
        'cancel_reason',    'Pedido y comprobante anulados por padre/tutor',
        'void_request_id',  v_rr.id::text
      )
    WHERE id = v_tx_id;
  END IF;

  -- ── PASO 6: Cancelar el pedido (lunch_order → cancelled) ─────────────────
  UPDATE lunch_orders
  SET
    is_cancelled        = true,
    status              = 'cancelled',
    cancelled_by        = p_parent_id,
    cancelled_at        = NOW(),
    cancellation_reason = 'Anulado por padre/tutor — comprobante invalidado para reenvío'
  WHERE id = p_order_id;

  -- ── PASO 7: Auditoría en huella_digital_logs (best-effort) ───────────────
  -- Si falla el log, la operación principal NO se revierte.
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      p_parent_id,
      'ANULACION_PEDIDO_CON_VOUCHER_PENDIENTE',
      'ALMUERZOS',
      jsonb_build_object(
        'order_id',            p_order_id,
        'recharge_request_id', v_rr.id,
        'reference_code',      v_rr.reference_code,
        'amount',              v_rr.amount,
        'student_id',          v_order.student_id,
        'tx_cancelled',        v_tx_id IS NOT NULL,
        'tx_id',               v_tx_id
      ),
      v_school_id,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'void_pending_lunch_order_v2: Auditoría falló (no crítico): %', SQLERRM;
  END;

  -- ── PASO 8: Retorno ───────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',             true,
    'order_cancelled',     true,
    'voucher_voided',      true,
    'recharge_request_id', v_rr.id,
    'reference_code',      v_rr.reference_code,
    'tx_cancelled',        v_tx_id IS NOT NULL,
    'tx_id',               v_tx_id
  );

END;
$$;

-- Permitir que padres autenticados llamen a esta función
GRANT EXECUTE ON FUNCTION void_pending_lunch_order_v2(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION void_pending_lunch_order_v2 IS
  'Anula atómicamente un pedido de almuerzo junto con su comprobante (recharge_request)
   pendiente de aprobación.
   - Solo opera cuando el pedido y el voucher están estrictamente en estado pending.
   - Si el voucher cubre múltiples pedidos, rechaza la operación (protección).
   - El reference_code queda liberado gracias al índice parcial actualizado
     (idx_recharge_unique_ref_code excluye voided + rejected).
   - Auditoría en huella_digital_logs (best-effort, no crítico).
   - NO afecta saldos: el pago nunca fue aprobado.
   - NO borra ningún registro: Audit Trail intacto.';

NOTIFY pgrst, 'reload schema';

SELECT 'void_pending_lunch_order_v2 creado OK — índice actualizado OK' AS resultado;
