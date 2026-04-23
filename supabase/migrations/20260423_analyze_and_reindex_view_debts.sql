-- ============================================================================
-- 2026-04-23 — ANALYZE + Reindexado tras recreación de view_student_debts
--
-- Al ejecutar DROP VIEW ... CASCADE y recrear la vista, PostgreSQL invalida
-- los planes de ejecución cacheados.  El planificador puede elegir un plan
-- subóptimo hasta que se refresquen las estadísticas con ANALYZE.
--
-- Este script:
--  1) Refresca estadísticas de las tablas clave de la vista.
--  2) Asegura que los índices críticos existan (idempotente con IF NOT EXISTS).
--  3) Verifica que get_parent_debts_v2 sigue en pie.
-- ============================================================================

-- ── 1. Refrescar estadísticas ─────────────────────────────────────────────
ANALYZE public.transactions;
ANALYZE public.lunch_orders;
ANALYZE public.students;
ANALYZE public.recharge_requests;

SELECT 'ANALYZE completado — estadísticas de las tablas clave actualizadas' AS paso_1;

-- ── 2. Garantizar índices críticos (todos IF NOT EXISTS — idempotentes) ────

-- Índice funcional sobre metadata->>'lunch_order_id'
-- Cubre: Tramo 2 NOT EXISTS → (t2.metadata->>'lunch_order_id') = lo.id::text
-- Incluye 'cancelled' porque el partial index no filtra payment_status.
CREATE INDEX IF NOT EXISTS idx_transactions_metadata_lunch_order_id
  ON public.transactions ((metadata->>'lunch_order_id'))
  WHERE is_deleted = false;

-- Índice GIN sobre metadata completo
-- Cubre: Tramo 2 NOT EXISTS → metadata ? 'original_lunch_ids' @> ...
CREATE INDEX IF NOT EXISTS idx_transactions_metadata_gin
  ON public.transactions USING GIN (metadata)
  WHERE is_deleted = false;

-- Índice composite para Tramo 1 (transacciones pendientes)
-- Cubre: WHERE type='purchase' AND payment_status IN ('pending','partial')
CREATE INDEX IF NOT EXISTS idx_transactions_type_status_active
  ON public.transactions (student_id, type, payment_status)
  WHERE is_deleted = false
    AND type = 'purchase'
    AND payment_status IN ('pending', 'partial');

-- Índice adicional para el nuevo caso 'cancelled' en el NOT EXISTS del Tramo 2
-- Permite que el planificador use un index scan para las transacciones canceladas
-- relacionadas con almuerzos.
CREATE INDEX IF NOT EXISTS idx_transactions_cancelled_lunch
  ON public.transactions (student_id, payment_status)
  WHERE is_deleted = false
    AND payment_status = 'cancelled'
    AND (metadata->>'lunch_order_id') IS NOT NULL;

-- Índice para get_parent_debts_v2 → join con recharge_requests
CREATE INDEX IF NOT EXISTS idx_recharge_requests_parent_status
  ON public.recharge_requests (parent_id, status, created_at DESC)
  WHERE status IN ('pending', 'rejected');

SELECT 'Índices garantizados (todos IF NOT EXISTS)' AS paso_2;

-- ── 3. Verificar que get_parent_debts_v2 sigue activa ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_parent_debts_v2'
  ) THEN
    RAISE EXCEPTION 'CRÍTICO: get_parent_debts_v2 no existe. Ejecuta primero 20260423_per_student_debt_summary.sql';
  END IF;
END;
$$;

SELECT 'get_parent_debts_v2 confirmada activa' AS paso_3;

-- ── 4. Prueba de humo: ejecutar la vista con un limite para verificar velocidad ──
SELECT COUNT(*) AS filas_en_view
FROM   public.view_student_debts
LIMIT  1;

SELECT 'ANALYZE + reindex completo — el timeout debería resolverse' AS resultado_final;
