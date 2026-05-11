-- ============================================================================
-- FASE 0 — MODO PREPAGO POR SEDE (FOUNDATION)
-- Fecha: 2026-05-10
--
-- Objetivo:
--   1) Agregar interruptor por sede en lunch_configuration:
--        force_prepayment (default FALSE)
--   2) Agregar máquina de estados de prepago en lunch_orders
--      sin romper la operación actual de cocina/reportes/pagos.
--
-- Principios aplicados:
--   - No borrar código ni columnas existentes.
--   - Reversibilidad total: si force_prepayment = FALSE, flujo actual intacto.
--   - Cero optimismo: cambios aditivos e idempotentes.
--   - Compatibilidad: NO se altera status actual de lunch_orders.
-- ============================================================================ 

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) INTERRUPTOR POR SEDE (lunch_configuration)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lunch_configuration
  ADD COLUMN IF NOT EXISTS force_prepayment boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lunch_configuration.force_prepayment IS
  'Interruptor por sede para modo prepago. FALSE = flujo actual (sin cambios). TRUE = pedidos nuevos pueden entrar en estado congelado hasta pago.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) MÁQUINA DE ESTADOS DE PREPAGO (lunch_orders)
--    Se implementa en columna separada para no romper status legacy.
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 Crear ENUM estricto (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'lunch_order_payment_state'
      AND t.typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.lunch_order_payment_state AS ENUM (
      'confirmed_paid',
      'frozen_pending_payment',
      'cancelled_expired'
    );
  END IF;
END;
$$;

COMMENT ON TYPE public.lunch_order_payment_state IS
  'Estados del flujo de prepago de almuerzos: confirmed_paid, frozen_pending_payment, cancelled_expired.';

-- 2.2 Agregar columna de estado nuevo (sin tocar status legacy)
ALTER TABLE public.lunch_orders
  ADD COLUMN IF NOT EXISTS payment_flow_state public.lunch_order_payment_state;

-- 2.3 Compatibilidad histórica:
--     Todo pedido existente queda marcado como confirmed_paid.
UPDATE public.lunch_orders
SET payment_flow_state = 'confirmed_paid'::public.lunch_order_payment_state
WHERE payment_flow_state IS NULL;

-- 2.4 Endurecer defaults y NOT NULL (idempotente)
ALTER TABLE public.lunch_orders
  ALTER COLUMN payment_flow_state SET DEFAULT 'confirmed_paid'::public.lunch_order_payment_state;

ALTER TABLE public.lunch_orders
  ALTER COLUMN payment_flow_state SET NOT NULL;

COMMENT ON COLUMN public.lunch_orders.payment_flow_state IS
  'Estado del flujo de prepago. confirmed_paid=visible para cocina; frozen_pending_payment=standby (oculto para cocina); cancelled_expired=no pagado vencido.';

-- 2.5 Índice para filtros operativos (kitchen/reportes)
CREATE INDEX IF NOT EXISTS idx_lunch_orders_payment_flow_state
  ON public.lunch_orders (payment_flow_state);

SELECT
  '20260510_c_prepayment_phase0_foundations ✅ force_prepayment + payment_flow_state creados con compatibilidad total' AS resultado;

