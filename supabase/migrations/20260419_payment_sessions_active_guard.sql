-- ══════════════════════════════════════════════════════════════════════════════
-- GUARD DE SESIÓN ACTIVA — Prevención del Ataque de Doble Pestaña
-- Fecha: 2026-04-19
-- ──────────────────────────────────────────────────────────────────────────────
-- PROBLEMA QUE RESUELVE:
--   Un padre abre el portal en dos pestañas simultáneas y genera dos formTokens
--   para la misma deuda. Si paga en ambas, el webhook acreditaría el saldo DOS
--   veces porque cada orden tiene un gateway_reference_id diferente.
--
-- SOLUCIÓN:
--   1. ÍNDICE ÚNICO PARCIAL sobre payment_sessions(student_id) restringido a
--      sesiones gateway activas (pending / processing). Solo puede existir UNA
--      sesión activa por alumno en la pasarela.
--
--   2. CHECK EXPLÍCITO en la Edge Function izipay-create-order que consulta
--      la tabla payment_transactions antes de crear un nuevo pedido a IziPay.
--      Si detecta una transacción pending para el mismo alumno con expiración
--      futura, devuelve HTTP 409 con un mensaje claro.
--
-- GARANTÍAS:
--   a) El índice único es el CANDADO PRIMARIO: aunque dos pestañas lleguen al
--      mismo tiempo, solo la primera puede crear la sesión. La segunda recibe
--      un error de unicidad de PostgreSQL.
--   b) La Edge Function es el CANDADO SECUNDARIO (más rápido, mejor UX):
--      devuelve un mensaje claro antes de llamar a IziPay, ahorrando una
--      transacción de API innecesaria.
--   c) El RPC apply_gateway_credit ya tiene IDEMPOTENCIA por gateway_reference_id:
--      incluso si dos órdenes distintas llegaran al webhook, solo la primera
--      con un gateway_reference_id nuevo podría acreditar.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 0: LIMPIEZA PREVIA — Resolver duplicados existentes antes del índice
-- ─────────────────────────────────────────────────────────────────────────────
-- Situación: el fallo del webhook de IziPay dejó múltiples sesiones
-- pending/processing para el mismo alumno (doble pestaña real).
-- El índice único NO puede crearse mientras existan esos duplicados.
--
-- Estrategia:
--   Por cada alumno con sesiones duplicadas, conservamos la MÁS RECIENTE
--   (la última que intentó pagar) y marcamos las anteriores como 'expired'.
--   Esto es seguro porque:
--   a) IziPay ya desactivado → ninguna de esas sesiones puede cobrar más.
--   b) El pago real (si ocurrió) se conciliará manualmente con manual_gateway_credit.
--   c) Las sesiones expired liberan el candado único sin perder la auditoría.

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Marcar como 'expired' todas las sesiones IziPay pending/processing
  -- EXCEPTO la más reciente por alumno (que conservamos por si hay auditoría).
  UPDATE public.payment_sessions ps
  SET
    gateway_status = 'expired'::public.gateway_payment_status,
    status         = 'expired'
  WHERE ps.gateway_name = 'izipay'
    AND ps.gateway_status IN (
          'pending'::public.gateway_payment_status,
          'processing'::public.gateway_payment_status
        )
    AND ps.id NOT IN (
      -- La sesión MÁS RECIENTE por alumno (la conservamos)
      SELECT DISTINCT ON (student_id) id
      FROM public.payment_sessions
      WHERE gateway_name    = 'izipay'
        AND gateway_status IN (
              'pending'::public.gateway_payment_status,
              'processing'::public.gateway_payment_status
            )
      ORDER BY student_id, created_at DESC
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'PASO 0: % sesión(es) duplicadas marcadas como expired (conservando la más reciente por alumno).', v_count;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ÍNDICE ÚNICO PARCIAL: un solo gateway activo por alumno a la vez
-- ─────────────────────────────────────────────────────────────────────────────
-- Aplica SOLO cuando hay una sesión IziPay en estado pendiente o procesando.
-- Sesiones completed / failed / expired / cancelled NO bloquean.
-- Esto permite al padre reintentar después de un pago fallido.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ps_student_one_active_izipay
  ON public.payment_sessions (student_id)
  WHERE gateway_name = 'izipay'
    AND gateway_status IN ('pending'::public.gateway_payment_status,
                           'processing'::public.gateway_payment_status);

COMMENT ON INDEX public.idx_ps_student_one_active_izipay IS
  'Candado primario anti-doble-pestaña: impide crear dos sesiones IziPay '
  'activas (pending/processing) para el mismo alumno de forma simultánea.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ÍNDICE ÚNICO PARCIAL: una sola payment_transaction pending por alumno
-- ─────────────────────────────────────────────────────────────────────────────
-- La tabla payment_transactions es el registro que crea la Edge Function.
-- Este índice complementa el anterior a nivel de la tabla de pasarela.

CREATE UNIQUE INDEX IF NOT EXISTS idx_pt_student_one_pending
  ON public.payment_transactions (student_id)
  WHERE status = 'pending';

COMMENT ON INDEX public.idx_pt_student_one_pending IS
  'Candado secundario: una sola transacción IziPay pendiente por alumno. '
  'Si el padre abre dos pestañas y ambas llaman a la Edge Function, solo '
  'la primera puede insertar. La segunda recibe error 409.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FUNCIÓN RPC para verificar sesión activa (usada desde la Edge Function)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_active_gateway_session(
  p_student_id  UUID,
  p_gateway     TEXT DEFAULT 'izipay'
)
RETURNS TABLE (
  session_id  UUID,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, expires_at, created_at
  FROM public.payment_sessions
  WHERE student_id    = p_student_id
    AND gateway_name  = p_gateway
    AND gateway_status IN ('pending', 'processing')
    AND expires_at > NOW()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.check_active_gateway_session IS
  'Devuelve la sesión gateway activa de un alumno (si existe). '
  'Usada por izipay-create-order para rechazar dobles solicitudes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. LIMPIEZA AUTOMÁTICA: expirar sesiones IziPay fantasmas
-- ─────────────────────────────────────────────────────────────────────────────
-- Sesiones que siguen en 'pending' después de su fecha de expiración se marcan
-- como 'expired'. Esto libera el índice único y permite al padre reintentar.

CREATE OR REPLACE FUNCTION public.expire_stale_gateway_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.payment_sessions
  SET gateway_status = 'expired'::public.gateway_payment_status,
      status         = 'expired'
  WHERE gateway_name  = 'izipay'
    AND gateway_status IN ('pending', 'processing')
    AND expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    RAISE NOTICE 'expire_stale_gateway_sessions: % sesión(es) expiradas.', v_count;
  END IF;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_gateway_sessions IS
  'Expira sesiones IziPay que siguen pending/processing después de su timeout. '
  'Puede llamarse periódicamente (cron) o desde la Edge Function de creación.';
