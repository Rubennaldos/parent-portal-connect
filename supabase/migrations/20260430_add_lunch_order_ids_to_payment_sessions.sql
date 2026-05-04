-- ============================================================================
-- payment_sessions: agregar trazabilidad explicita de lunch_order_ids
-- Fecha: 2026-04-30
--
-- Motivo:
--   El flujo IziPay necesita vincular la session de pago con los pedidos de
--   almuerzo exactos para que el webhook pueda marcarlos como pagados de forma
--   directa y auditada tras la aprobacion del banco.
-- ============================================================================

ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS lunch_order_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.payment_sessions.lunch_order_ids IS
  'IDs de lunch_orders vinculados a la sesion de pago IziPay para cierre contable directo en webhook.';

SELECT '20260430_add_lunch_order_ids_to_payment_sessions OK' AS resultado;
