-- ============================================================================
-- 2026-04-26 — Anular espejos lunch_approval_mirror pending "fantasma"
--
-- CONTEXTO:
--   Tras 20260424_repair_tmad_plin_lunch_order_metadata.sql, una compra paid
--   puede tener lunch_order_id nuevo y lunch_metadata_repair_prior_lunch_order_id
--   = pedido viejo. fn_ensure (2026-04-25) ya no inserta duplicados, pero pueden
--   quedar filas insertadas ANTES con:
--     lunch_approval_mirror = true, payment_status = pending,
--     metadata.lunch_order_id = pedido viejo
--   mientras existe otra paid del mismo alumno con prior = ese pedido.
--
-- ACCIÓN:
--   Marcar is_deleted en esas filas (idempotente por condiciones).
-- ============================================================================

UPDATE public.transactions t
SET
  is_deleted = true,
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'void_reason', 'phantom_mirror_pending_while_paid_tx_has_same_prior_lunch',
    'void_migration', '20260426_void_phantom_mirrors_when_prior_repair_paid'
  )
WHERE t.is_deleted = false
  AND t.type = 'purchase'
  AND t.payment_status = 'pending'
  AND (t.metadata->>'lunch_approval_mirror') = 'true'
  AND NULLIF(t.metadata->>'lunch_order_id', '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.transactions p
    WHERE p.is_deleted = false
      AND p.type = 'purchase'
      AND p.payment_status = 'paid'
      AND p.student_id = t.student_id
      AND NULLIF(p.metadata->>'lunch_metadata_repair_prior_lunch_order_id', '')
        = (t.metadata->>'lunch_order_id')
  );

SELECT '20260426_void_phantom_mirrors_when_prior_repair_paid OK' AS resultado;
