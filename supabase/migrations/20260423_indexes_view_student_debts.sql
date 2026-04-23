-- ============================================================================
-- ÍNDICES CRÍTICOS para view_student_debts — Statement Timeout Fix
-- Fecha: 2026-04-23
--
-- PROBLEMA:
--   view_student_debts tiene dos NOT EXISTS con comparaciones JSONB:
--
--   Tramo 2 (lunch_orders sin transacción):
--     NOT EXISTS (
--       SELECT 1 FROM transactions t2
--       WHERE (t2.metadata->>'lunch_order_id') = lo.id::text   ← full scan
--          OR t2.metadata->'original_lunch_ids' @> to_jsonb(ARRAY[lo.id::text])
--     )
--
--   Tramo 3 (saldo kiosco negativo):
--     NOT EXISTS (
--       SELECT 1 FROM transactions t3
--       WHERE t3.student_id = s.id
--         AND t3.type = 'purchase'
--         AND t3.payment_status IN ('pending', 'partial')
--         AND (t3.metadata->>'lunch_order_id') IS NULL     ← función sobre JSONB sin índice
--     )
--
--   Sin índices = full scan de TODA la tabla transactions por cada lunch_order/student.
--   Con N almuerzos y M transacciones → O(N×M) → timeout.
--
-- SOLUCIÓN:
--   4 índices que cubren exactamente las comparaciones de los NOT EXISTS.
-- ============================================================================


-- ── Índice 1: functional B-tree sobre metadata->>'lunch_order_id' ────────────
-- Cubre: Tramo 2 → (t2.metadata->>'lunch_order_id') = lo.id::text
-- Cubre: Tramo 3 → (t3.metadata->>'lunch_order_id') IS NULL  (vía partial scan)
CREATE INDEX IF NOT EXISTS idx_transactions_metadata_lunch_order_id
  ON public.transactions ((metadata->>'lunch_order_id'))
  WHERE is_deleted = false;

-- ── Índice 2: GIN sobre metadata completo ─────────────────────────────────────
-- Cubre: Tramo 2 → t2.metadata @> / metadata ? 'original_lunch_ids' / containment @>
-- GIN es el índice nativo de PostgreSQL para operadores JSONB (@>, ?, ?|, ?&).
CREATE INDEX IF NOT EXISTS idx_transactions_metadata_gin
  ON public.transactions USING GIN (metadata)
  WHERE is_deleted = false;

-- ── Índice 3: composite para Tramo 1 (transacciones pendientes) ───────────────
-- Cubre: Tramo 1 → WHERE type='purchase' AND is_deleted=false AND payment_status IN (...)
-- También acelera Tramo 3 NOT EXISTS.
CREATE INDEX IF NOT EXISTS idx_transactions_type_status_active
  ON public.transactions (student_id, type, payment_status)
  WHERE is_deleted = false
    AND type = 'purchase'
    AND payment_status IN ('pending', 'partial');

-- ── Índice 4: composite para get_parent_debts_v2 (join con recharge_requests) ─
-- Cubre: el LATERAL join sobre recharge_requests que busca por parent_id + status
CREATE INDEX IF NOT EXISTS idx_recharge_requests_parent_status
  ON public.recharge_requests (parent_id, status, created_at DESC)
  WHERE status IN ('pending', 'rejected');

SELECT 'Índices view_student_debts creados — timeout fix aplicado' AS resultado;
