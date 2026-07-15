-- ============================================================================
-- MIGRACIÓN: atomic_lunch_cancellation_bridge
-- Fecha: 2026-05-24
--
-- PROBLEMA:
--   Existen múltiples rutas de anulación de pedidos de almuerzo:
--     A. RPC cancel_lunch_order         (admin desde Pedidos — con contraseña)
--     B. RPC void_pending_lunch_order_v2 (padre con voucher pendiente)
--     C. LunchOrderActionsModal         (UPDATE directo: solo status, sin is_cancelled)
--     D. handleCancelOrder UI parent    (UPDATE directo: is_cancelled + status)
--     E. cancel_lunch_order_with_wallet_credit (desde Cobranzas — solo busca paid/partial)
--
--   Las rutas C, D y E pueden dejar transactions en estado 'pending' cuando
--   el lunch_order ya está cancelado, creando deuda huérfana visible en Cobranzas.
--
-- SOLUCIÓN:
--   Trigger AFTER UPDATE en lunch_orders que actúa como red de seguridad
--   atómica. Si alguna ruta olvidó cancelar la transacción, el trigger lo hace
--   dentro de la misma transacción SQL — sin importar quién llamó el UPDATE.
--
-- GARANTÍAS:
--   1. SUNAT: NUNCA toca transacciones con billing_status = 'sent'.
--      (El trigger fn_prevent_modifying_sent_transactions haría rollback si
--       intentáramos cambiar payment_status en una fila 'sent'.)
--   2. Idempotente: si la transacción ya está 'cancelled', el WHERE no la toca.
--   3. No duplica lógica de RPCs: si el RPC ya canceló la transacción antes de
--      actualizar lunch_orders, el trigger no encuentra filas 'pending' y no actúa.
--   4. Cubre duplicados: a diferencia de los RPCs (LIMIT 1), el trigger cancela
--      TODAS las transactions pending vinculadas al pedido.
--   5. Solo dispara en transición: la condición IS DISTINCT FROM evita re-firing
--      cuando un pedido ya cancelado recibe otro UPDATE (ej: agregar nota).
--   6. No altera RLS, roles ni permisos existentes.
--
-- REPARACIÓN HISTÓRICA:
--   Incluye un UPDATE puntual que cierra todas las transactions 'pending'
--   que hoy tienen su lunch_order ya cancelado. Respeta el guard de SUNAT.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — FUNCIÓN DEL TRIGGER
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_sync_cancelled_lunch_order_to_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── Guard de transición ──────────────────────────────────────────────────
  -- Actúa SOLO cuando la fila pasa a estado cancelado en este UPDATE.
  -- Si el pedido ya estaba cancelado y alguien actualiza otro campo (ej: notas),
  -- el trigger no hace nada — evita re-runs innecesarios.
  --
  -- Se capturan DOS condiciones porque las rutas de anulación son inconsistentes:
  --   · Ruta C (LunchOrderActionsModal) → solo cambia status a 'cancelled',
  --     no toca is_cancelled.
  --   · Rutas A, B, D → cambian ambos campos.
  -- Con OR cobertura es completa sin importar la ruta.

  IF NOT (
    (NEW.status      = 'cancelled' AND OLD.status      IS DISTINCT FROM 'cancelled')
    OR
    (NEW.is_cancelled = true       AND OLD.is_cancelled IS DISTINCT FROM true)
  ) THEN
    RETURN NEW;
  END IF;

  -- ── Cancelar todas las transactions pending/partial vinculadas ───────────
  --
  -- EXCEPCIÓN CRÍTICA — billing_status = 'sent':
  --   Si la fila tiene billing_status = 'sent', existe un boleta emitida en SUNAT.
  --   Cambiar payment_status en esa fila haría disparar fn_prevent_modifying_sent_transactions
  --   con RAISE EXCEPTION, revirtiendo toda la transacción (incluyendo la cancelación
  --   del pedido). Por eso las excluimos del UPDATE: el admin debe emitir
  --   una Nota de Crédito manualmente, igual que en los RPCs existentes.
  --
  -- COALESCE(billing_status, '') <> 'sent'  →  cubre NULL, 'pending', 'excluded', 'error'.

  UPDATE public.transactions
  SET
    payment_status = 'cancelled',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelled_at',        timezone('America/Lima', now())::text,
      'cancellation_source', 'db_trigger_atomic_bridge',
      'lunch_order_id',      NEW.id::text
    )
  WHERE (metadata->>'lunch_order_id') = NEW.id::text
    AND payment_status                IN ('pending', 'partial')
    AND type                          = 'purchase'
    AND COALESCE(is_deleted, false)   = false
    AND COALESCE(billing_status, '')  <> 'sent';

  RETURN NEW;

END;
$$;

COMMENT ON FUNCTION public.fn_sync_cancelled_lunch_order_to_transaction() IS
  'Red de seguridad atómica: cuando lunch_orders pasa a cancelled, cancela las
   transactions purchase pending/partial vinculadas. Respeta billing_status=sent
   (boletas SUNAT) y es idempotente. Disparada por trg_sync_cancelled_lunch_to_transaction.';


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — TRIGGER (idempotente con DROP IF EXISTS)
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_sync_cancelled_lunch_to_transaction
  ON public.lunch_orders;

CREATE TRIGGER trg_sync_cancelled_lunch_to_transaction
  AFTER UPDATE ON public.lunch_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_cancelled_lunch_order_to_transaction();

COMMENT ON TRIGGER trg_sync_cancelled_lunch_to_transaction ON public.lunch_orders IS
  'Cierra deuda huérfana: cancela transactions pending cuando el lunch_order
   se marca como cancelled. Aplica sin importar la ruta de anulación (RPC, frontend, etc.).';


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — REPARACIÓN HISTÓRICA (one-shot, idempotente)
--
-- Cierra todas las transactions 'pending'/'partial' que hoy están huérfanas
-- porque su lunch_order ya fue cancelado por alguna de las rutas defectuosas.
-- Respeta el guard de SUNAT: NO toca billing_status = 'sent'.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.transactions t
SET
  payment_status = 'cancelled',
  metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'cancelled_at',        timezone('America/Lima', now())::text,
    'cancellation_source', 'historical_repair_20260524',
    'repaired_at',         now()::text
  )
FROM public.lunch_orders lo
WHERE (t.metadata->>'lunch_order_id')        = lo.id::text
  AND t.payment_status                        IN ('pending', 'partial')
  AND t.type                                  = 'purchase'
  AND COALESCE(t.is_deleted, false)           = false
  AND COALESCE(t.billing_status, '')          <> 'sent'
  AND (lo.is_cancelled = true OR lo.status    = 'cancelled');


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4 — VERIFICACIÓN POST-MIGRACIÓN (diagnóstico read-only)
--
-- Retorna las filas que SIGUEN inconsistentes después de la reparación.
-- Un resultado vacío confirma que la migración resolvió todos los casos.
-- Las filas con billing_status = 'sent' son las únicas que pueden quedar
-- inconsistentes de forma legítima (requieren Nota de Crédito SUNAT).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_huerfanas        INTEGER;
  v_huerfanas_sunat  INTEGER;
BEGIN

  -- Transacciones huérfanas resolubles (no SUNAT)
  SELECT COUNT(*) INTO v_huerfanas
  FROM public.transactions t
  JOIN public.lunch_orders lo ON (t.metadata->>'lunch_order_id') = lo.id::text
  WHERE t.payment_status                 IN ('pending', 'partial')
    AND t.type                           = 'purchase'
    AND COALESCE(t.is_deleted, false)    = false
    AND COALESCE(t.billing_status, '')   <> 'sent'
    AND (lo.is_cancelled = true OR lo.status = 'cancelled');

  -- Transacciones huérfanas SUNAT (legítimas, requieren NC)
  SELECT COUNT(*) INTO v_huerfanas_sunat
  FROM public.transactions t
  JOIN public.lunch_orders lo ON (t.metadata->>'lunch_order_id') = lo.id::text
  WHERE t.payment_status                 IN ('pending', 'partial')
    AND t.type                           = 'purchase'
    AND COALESCE(t.is_deleted, false)    = false
    AND t.billing_status                 = 'sent'
    AND (lo.is_cancelled = true OR lo.status = 'cancelled');

  IF v_huerfanas > 0 THEN
    RAISE WARNING
      '[atomic_lunch_cancellation_bridge] POST-FIX: quedan % transacciones '
      'huérfanas sin resolver. Revisar manualmente.',
      v_huerfanas;
  ELSE
    RAISE NOTICE
      '[atomic_lunch_cancellation_bridge] OK — 0 transacciones huérfanas '
      'resolubles tras la reparación.';
  END IF;

  IF v_huerfanas_sunat > 0 THEN
    RAISE NOTICE
      '[atomic_lunch_cancellation_bridge] INFO — % transacción(es) vinculadas a '
      'pedidos cancelados con billing_status=sent. Requieren Nota de Crédito SUNAT. '
      'Esto es comportamiento esperado y NO es un error.',
      v_huerfanas_sunat;
  END IF;

END;
$$;

SELECT '20260524_atomic_lunch_cancellation_bridge OK' AS resultado;
