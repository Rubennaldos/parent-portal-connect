-- ============================================================================
-- AUDITORÍA BANCARIA — Índices de performance para view_recharge_ledger
-- Fecha: 2026-04-18
--
-- Grietas detectadas:
--   1. recharge_requests no tiene índice que incluya request_type → la vista FIFO
--      filtra WHERE request_type='recharge' AND status='approved' pero el índice
--      existente (idx_rr_status_approved_at) no cubre request_type.
--
--   2. auditoria_vouchers.id_cobranza es FK sin índice → el LATERAL JOIN de la
--      vista lo usa para buscar el hash/URL del voucher. Sin índice: seq scan.
--
--   3. transactions tiene índice para deudas (payment_status IN ('pending','partial'))
--      pero NO para consumo FIFO (type='purchase', payment_status='paid',
--      lunch_order_id IS NULL). La vista calcula cuánto consumió cada alumno.
--
-- Todos son B-TREE. Se usan IF NOT EXISTS para idempotencia.
-- ============================================================================

-- ── 1. recharge_requests — índice compuesto para la vista FIFO ───────────────
--    Cubre la query: WHERE student_id = X AND request_type = 'recharge'
--                      AND status = 'approved'
--    Incluye created_at para el ORDER BY del FIFO window.
CREATE INDEX IF NOT EXISTS idx_rr_student_type_status
  ON recharge_requests (student_id, request_type, status, created_at ASC)
  WHERE status IN ('approved', 'pending');

COMMENT ON INDEX idx_rr_student_type_status IS
  'Índice compuesto para view_recharge_ledger: filtra recargas activas/pendientes '
  'por alumno ordenadas cronológicamente (FIFO). Sin este índice la vista hace '
  'seq scan en recharge_requests con miles de registros.';

-- ── 2. auditoria_vouchers — índice en FK id_cobranza ─────────────────────────
--    La vista hace LATERAL JOIN: auditoria_vouchers WHERE id_cobranza = rr.id
--    Actualmente no existe índice en esta columna.
CREATE INDEX IF NOT EXISTS idx_auditoria_vouchers_id_cobranza
  ON auditoria_vouchers (id_cobranza)
  WHERE id_cobranza IS NOT NULL;

COMMENT ON INDEX idx_auditoria_vouchers_id_cobranza IS
  'FK auditoria_vouchers → recharge_requests. Evita seq scan en el LATERAL JOIN '
  'de view_recharge_ledger que recupera hash/URL del voucher por id_cobranza.';

-- ── 3. transactions — consumo FIFO por alumno (compras pagadas del kiosco) ───
--    La vista calcula cuánto consumió cada alumno sumando sus compras pagadas
--    sin lunch_order_id (kiosco puro).
--    El índice existente idx_transactions_active_debts cubre pending/partial,
--    no 'paid'. Creamos uno específico para el consumo.
CREATE INDEX IF NOT EXISTS idx_transactions_kiosk_paid
  ON transactions (student_id, created_at ASC)
  WHERE type           = 'purchase'
    AND payment_status = 'paid'
    AND is_deleted     = false
    AND (metadata->>'lunch_order_id') IS NULL;

COMMENT ON INDEX idx_transactions_kiosk_paid IS
  'Índice parcial para el cálculo FIFO de consumo de recargas en kiosco. '
  'Sólo incluye compras de kiosco ya pagadas (sin lunch_order_id). '
  'Usado por view_recharge_ledger para calcular recharge_consumed_amount.';

-- ── Verificación ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text[] := '{}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'recharge_requests'
      AND indexname  = 'idx_rr_student_type_status'
  ) THEN
    v_missing := v_missing || 'idx_rr_student_type_status';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'auditoria_vouchers'
      AND indexname  = 'idx_auditoria_vouchers_id_cobranza'
  ) THEN
    v_missing := v_missing || 'idx_auditoria_vouchers_id_cobranza';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'transactions'
      AND indexname  = 'idx_transactions_kiosk_paid'
  ) THEN
    v_missing := v_missing || 'idx_transactions_kiosk_paid';
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE WARNING '⚠️  Índices NO creados: %', array_to_string(v_missing, ', ');
  ELSE
    RAISE NOTICE '✅  3/3 índices de performance verificados correctamente.';
  END IF;
END $$;
