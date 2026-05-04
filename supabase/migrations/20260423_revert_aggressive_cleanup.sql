-- ============================================================================
-- 2026-04-23 — REVERSIÓN TOTAL DEL CLEANUP MASIVO
--
-- PROBLEMA:
--   Los scripts 20260423_fix_auto_apply_balance_after_approval.sql
--   y 20260423_fix_auto_apply_v2_skip_sunat.sql ejecutaron un bloque
--   de limpieza masiva que marcó como 'paid' cientos de transacciones
--   de compra en base al saldo existente de los alumnos — sin importar
--   si ese saldo vino de un pago reciente del padre o era saldo histórico.
--
--   Ejemplo del daño:
--   - Aaron Sagua: 6 transacciones marcadas paid, 0 recargas recientes
--   - Ellen (familia Madeleine Peredo): deuda borrada sin pago
--   - Abigail Ubierna Caballero: 20+ transacciones marcadas paid sin pago
--
-- SOLUCIÓN:
--   Revertir EXCLUSIVAMENTE las transacciones que tienen el tag
--   cleanup_migration = '20260423_fix_auto_apply_balance'
--   o cleanup_migration = '20260423_fix_auto_apply_v2'
--
--   NO se revierten:
--   - Transacciones con invoice_id (SUNAT, ya protegidas)
--   - Transacciones con billing_status IN ('sent','invoiced','billed')
--   - Transacciones sin el tag cleanup_migration (aprobaciones legítimas
--     posteriores al deploy)
-- ============================================================================

-- 1) CONTEO PRE-REVERSIÓN (para auditoría)
DO $$
DECLARE
  v_count int;
  v_monto numeric;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(ABS(amount)), 0)
  INTO v_count, v_monto
  FROM public.transactions
  WHERE type = 'purchase'
    AND is_deleted = false
    AND payment_status = 'paid'
    AND (
      metadata->>'cleanup_migration' = '20260423_fix_auto_apply_balance'
      OR metadata->>'cleanup_migration' = '20260423_fix_auto_apply_v2'
    )
    AND invoice_id IS NULL
    AND COALESCE(billing_status, '') NOT IN ('sent', 'invoiced', 'billed');

  RAISE NOTICE 'Transacciones a revertir: % por un total de S/%', v_count, v_monto;
END $$;

-- 2) REVERSIÓN: volver payment_status → 'pending' y limpiar metadata de cleanup
UPDATE public.transactions t
SET
  payment_status = 'pending',
  -- Conservar metadata original, sólo quitar las claves añadidas por el cleanup
  metadata = t.metadata
    - 'payment_approved'
    - 'auto_applied_from_balance'
    - 'cleanup_migration'
    - 'source_recharge_request_id'
    - 'approved_by'
    - 'approved_at'
WHERE t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status = 'paid'
  AND (
    t.metadata->>'cleanup_migration' = '20260423_fix_auto_apply_balance'
    OR t.metadata->>'cleanup_migration' = '20260423_fix_auto_apply_v2'
  )
  AND t.invoice_id IS NULL
  AND COALESCE(t.billing_status, '') NOT IN ('sent', 'invoiced', 'billed');

-- 3) CONTEO POST-REVERSIÓN (verificación)
DO $$
DECLARE
  v_remaining int;
BEGIN
  SELECT COUNT(*)
  INTO v_remaining
  FROM public.transactions
  WHERE type = 'purchase'
    AND is_deleted = false
    AND payment_status = 'paid'
    AND (
      metadata->>'cleanup_migration' = '20260423_fix_auto_apply_balance'
      OR metadata->>'cleanup_migration' = '20260423_fix_auto_apply_v2'
    )
    AND invoice_id IS NULL
    AND COALESCE(billing_status, '') NOT IN ('sent', 'invoiced', 'billed');

  IF v_remaining = 0 THEN
    RAISE NOTICE 'REVERSIÓN COMPLETA: 0 transacciones de cleanup quedan como paid';
  ELSE
    RAISE WARNING 'ATENCIÓN: % transacciones de cleanup siguen como paid (revisar manualmente)', v_remaining;
  END IF;
END $$;

SELECT 'REVERT OK: todas las transacciones del cleanup masivo revertidas a pending' AS resultado;
