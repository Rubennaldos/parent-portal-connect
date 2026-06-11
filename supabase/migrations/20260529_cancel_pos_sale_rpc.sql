-- ============================================================================
-- RPC: cancel_pos_sale
-- Fecha: 2026-05-29
--
-- Propósito: anulación operativa de una venta POS en una sola transacción SQL.
--
-- Hace:
--   1. Marca transactions.payment_status = 'cancelled' con metadata de auditoría.
--   2. Por cada transaction_item con product_id:
--      · Suma de vuelta la cantidad a product_stock (solo si is_enabled = true).
--      · Registra movimiento inverso en pos_stock_movements (ajuste_manual).
--
-- NO hace (por decisión de negocio explícita):
--   · No modifica sales.payment_method (evita el error 23514).
--   · No llama adjust_student_balance (devolución de dinero es manual).
--   · No toca lunch_orders.
--   · No anula comprobantes SUNAT (bloqueado: usar flujo void_pos_sale_with_nc).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_pos_sale(
  p_transaction_id uuid,
  p_admin_id       uuid,
  p_reason         text    DEFAULT 'Anulación de venta desde POS',
  p_refund_method  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id       uuid;
  v_actor_role     text;
  v_tx             transactions%ROWTYPE;
  v_item           record;
  v_stock_before   integer;
  v_stock_after    integer;
  v_rows_updated   integer;
  v_items_restored integer := 0;
BEGIN

  -- ── 1. Autenticación ──────────────────────────────────────────────────────
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_actor_id <> p_admin_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: p_admin_id no coincide con auth.uid().'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 2. Autorización por rol ───────────────────────────────────────────────
  SELECT p.role INTO v_actor_role
  FROM profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_role NOT IN (
    'admin_general', 'superadmin', 'gestor_unidad', 'admin_sede',
    'cajero', 'operador_caja'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Rol % no autorizado para esta operación.', v_actor_role
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 3. Bloqueo y lectura de la transacción ────────────────────────────────
  SELECT * INTO v_tx
  FROM transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: La transacción % no existe.', p_transaction_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 4. Validaciones de estado ─────────────────────────────────────────────
  IF COALESCE(v_tx.is_deleted, false) THEN
    RAISE EXCEPTION 'INVALID_STATE: La transacción está eliminada lógicamente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.payment_status = 'cancelled' THEN
    RAISE EXCEPTION 'IDEMPOTENT_ABORT: La venta ya fue cancelada anteriormente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Guardia SUNAT: ventas con comprobante ya enviado deben pasar por NC
  IF v_tx.billing_status = 'sent' THEN
    RAISE EXCEPTION 'SUNAT_INTEGRITY: Esta venta tiene un comprobante enviado a SUNAT. Use el flujo de Nota de Crédito desde el módulo de facturación.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 5. Marcar la transacción como cancelada ───────────────────────────────
  UPDATE transactions
  SET
    payment_status = 'cancelled',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by',        v_actor_id::text,
      'cancelled_at',        to_char(timezone('America/Lima', now()), 'YYYY-MM-DD"T"HH24:MI:SS'),
      'cancellation_reason', p_reason,
      'refund_method',       p_refund_method,
      'void_source',         'cancel_pos_sale'
    )
  WHERE id = p_transaction_id
    AND payment_status <> 'cancelled';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'CONCURRENT_ABORT: La fila cambió durante el proceso. Intenta nuevamente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 6. Devolución de stock por ítem ───────────────────────────────────────
  -- Solo actúa sobre productos con fila activa en product_stock (is_enabled = true).
  -- Replica la condición inversa de complete_pos_sale_v2 paso 13.
  FOR v_item IN
    SELECT
      ti.product_id,
      ti.quantity::integer AS qty,
      ti.product_name
    FROM transaction_items ti
    WHERE ti.transaction_id = p_transaction_id
      AND ti.product_id IS NOT NULL
  LOOP

    -- Omitir si no existe control de stock activo para este producto+sede
    IF NOT EXISTS (
      SELECT 1
      FROM product_stock ps
      WHERE ps.product_id = v_item.product_id
        AND ps.school_id  = v_tx.school_id
        AND ps.is_enabled = true
    ) THEN
      CONTINUE;
    END IF;

    -- Devolver unidades y capturar stock antes/después en una sola operación
    UPDATE product_stock
    SET
      current_stock = current_stock + v_item.qty,
      last_updated  = clock_timestamp()
    WHERE product_id = v_item.product_id
      AND school_id  = v_tx.school_id
      AND is_enabled = true
    RETURNING
      current_stock - v_item.qty,  -- stock_before (antes de la suma)
      current_stock                -- stock_after  (ya sumado)
    INTO v_stock_before, v_stock_after;

    -- Registrar en Kardex POS (movimiento inverso a la venta)
    -- quantity_delta positivo = ingreso de stock (devolución).
    -- La constraint chk_psm_delta exige stock_after = stock_before + quantity_delta.
    INSERT INTO pos_stock_movements (
      product_id,
      school_id,
      movement_type,
      quantity_delta,
      stock_before,
      stock_after,
      reference_id,
      created_by,
      created_at,
      reason
    ) VALUES (
      v_item.product_id,
      v_tx.school_id,
      'ajuste_manual',
      v_item.qty,
      v_stock_before,
      v_stock_after,
      p_transaction_id,
      v_actor_id,
      clock_timestamp(),
      'Anulación de venta desde POS - ' || COALESCE(v_item.product_name, 'Producto')
    );

    v_items_restored := v_items_restored + 1;
  END LOOP;

  -- ── 7. Respuesta ──────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',        true,
    'transaction_id', p_transaction_id,
    'items_restored', v_items_restored
  );

END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pos_sale(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_pos_sale(uuid, uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_pos_sale(uuid, uuid, text, text) IS
  'Anula operativamente una venta POS: marca transactions como cancelled, '
  'devuelve stock a product_stock y registra movimiento inverso (ajuste_manual) '
  'en pos_stock_movements. NO modifica sales.payment_method ni students.balance. '
  'Bloqueado si billing_status=sent (requiere flujo NC SUNAT).';
