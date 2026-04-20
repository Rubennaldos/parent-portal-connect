-- ══════════════════════════════════════════════════════════════════════════════
-- FIX: Separar "tiempo de espera del padre" del "tiempo de vida del webhook"
-- Fecha: 2026-04-19
-- ──────────────────────────────────────────────────────────────────────────────
-- PROBLEMA QUE RESUELVE:
--   El cambio anterior puso expires_at = 1 minuto para que el padre pueda
--   reintentar rápido. Sin embargo, un pago con 3DS puede tardar 2-4 minutos.
--   Si el webhook llega DESPUÉS de que expire_stale_gateway_sessions marcó la
--   sesión como 'expired', payment_sessions.gateway_status nunca llega a
--   'success' → GatewayPaymentWaiting queda en spinner indefinido.
--
-- SOLUCIÓN:
--   1. check_active_gateway_session usa created_at (ventana de 90 segundos)
--      en lugar de expires_at. Así el padre puede reintentar en 90 segundos,
--      independientemente de cuándo expire la sesión.
--
--   2. expire_stale_gateway_sessions usa una ventana fija de 20 minutos
--      (mucho más que el tiempo máximo de un pago con 3DS).
--      Esto garantiza que el webhook siempre encuentre la sesión activa.
--
--   3. El frontend sigue creando expires_at = NOW() + 15 min (suficiente margen)
--      pero ese campo ya no es el árbitro del guard de doble-pestaña.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Actualizar check_active_gateway_session ────────────────────────────────
-- Cambia de "expires_at > NOW()" a "created_at > NOW() - INTERVAL '90 seconds'"
-- Ventana de guard = 90 segundos (tiempo razonable para que el padre reintente)
-- Ventana de vida real del webhook = 15-20 minutos (manejada por expire_stale)

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
    -- Guard activo solo durante los primeros 90 segundos desde la creación
    AND created_at > NOW() - INTERVAL '90 seconds'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.check_active_gateway_session IS
  'Devuelve la sesión gateway activa de un alumno si fue creada hace menos de '
  '90 segundos. Permite al padre reintentar después de 90s sin necesitar que '
  'la sesión anterior haya expirado en la DB. '
  'Usada por izipay-create-order para rechazar dobles solicitudes.';

-- ── 2. Actualizar expire_stale_gateway_sessions ──────────────────────────────
-- Usa ventana de 20 minutos en lugar de expires_at.
-- Garantiza que el webhook (que puede llegar varios minutos después) siempre
-- pueda actualizar la sesión a 'success' sin encontrarla ya 'expired'.

CREATE OR REPLACE FUNCTION public.expire_stale_gateway_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Expirar sesiones pendientes/procesando con más de 20 minutos de vida.
  -- 20 min >> tiempo máximo de un pago 3DS (~4 min) → el webhook siempre llega antes.
  UPDATE public.payment_sessions
  SET gateway_status = 'expired'::public.gateway_payment_status,
      status         = 'expired'
  WHERE gateway_name  = 'izipay'
    AND gateway_status IN ('pending', 'processing')
    AND created_at < NOW() - INTERVAL '20 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    RAISE NOTICE 'expire_stale_gateway_sessions: % sesión(es) expiradas (>20 min).', v_count;
  END IF;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_gateway_sessions IS
  'Expira sesiones IziPay pending/processing con más de 20 minutos de vida. '
  'La ventana de 20 min garantiza que el webhook siempre llegue a tiempo. '
  'El guard de doble-pestaña usa check_active_gateway_session (90 segundos).';
