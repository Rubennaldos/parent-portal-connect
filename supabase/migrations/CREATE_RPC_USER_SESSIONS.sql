-- ============================================================
-- RPC: get_user_sessions
-- Permite a admins consultar las sesiones activas de un usuario
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_sessions(p_user_id UUID)
RETURNS TABLE (
  session_id    UUID,
  user_id       UUID,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  not_after     TIMESTAMPTZ,
  user_agent    TEXT,
  ip            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  -- Solo admins pueden llamar esta función
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: solo administradores pueden consultar sesiones';
  END IF;

  RETURN QUERY
  SELECT
    s.id          AS session_id,
    s.user_id,
    s.created_at,
    s.updated_at,
    s.not_after,
    NULL::TEXT    AS user_agent,
    NULL::TEXT    AS ip
  FROM auth.sessions s
  WHERE s.user_id = p_user_id
    AND (s.not_after IS NULL OR s.not_after > NOW())
  ORDER BY s.updated_at DESC;
END;
$$;

-- Dar permisos de ejecución a usuarios autenticados
GRANT EXECUTE ON FUNCTION get_user_sessions(UUID) TO authenticated;

SELECT 'RPC get_user_sessions creada correctamente' AS resultado;


-- ============================================================
-- RPC: revoke_user_sessions
-- Permite a admins cerrar todas las sesiones de un usuario
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION revoke_user_sessions(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Solo admins pueden llamar esta función
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: solo administradores pueden cerrar sesiones';
  END IF;

  -- Eliminar todas las sesiones del usuario (incluyendo refresh tokens)
  DELETE FROM auth.refresh_tokens
  WHERE user_id = p_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM auth.sessions
  WHERE user_id = p_user_id;

  RETURN 'OK: ' || v_count || ' refresh token(s) revocados';
END;
$$;

-- Dar permisos de ejecución a usuarios autenticados
GRANT EXECUTE ON FUNCTION revoke_user_sessions(UUID) TO authenticated;

SELECT 'RPC revoke_user_sessions creada correctamente' AS resultado;


-- ============================================================
-- RPC: revoke_single_session — cierra una sesión por ID
-- ============================================================

CREATE OR REPLACE FUNCTION revoke_single_session(p_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM auth.sessions WHERE id = p_session_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  DELETE FROM auth.refresh_tokens WHERE session_id = p_session_id;
  DELETE FROM auth.sessions WHERE id = p_session_id;
  RETURN 'OK';
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_single_session(UUID) TO authenticated;

SELECT 'RPC revoke_single_session creada correctamente' AS resultado;
