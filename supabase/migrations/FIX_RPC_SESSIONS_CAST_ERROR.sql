-- ============================================================
-- RECREAR RPCs de sesiones con tipos correctos
-- El error "character varying = uuid" se corrige con ::text cast
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- 1) get_user_sessions
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
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado';
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

GRANT EXECUTE ON FUNCTION get_user_sessions(UUID) TO authenticated;
SELECT 'OK: get_user_sessions recreada' AS resultado;


-- 2) revoke_user_sessions (cierra TODAS las sesiones)
CREATE OR REPLACE FUNCTION revoke_user_sessions(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  -- Usar ::text en la comparación para evitar el error character varying = uuid
  DELETE FROM auth.refresh_tokens
  WHERE user_id::text = p_user_id::text;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM auth.sessions
  WHERE user_id::text = p_user_id::text;

  RETURN 'OK: ' || v_count || ' token(s) revocados';
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_user_sessions(UUID) TO authenticated;
SELECT 'OK: revoke_user_sessions recreada' AS resultado;


-- 3) revoke_single_session (cierra UNA sesión por ID)
CREATE OR REPLACE FUNCTION revoke_single_session(p_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Buscar la sesión usando ::text para evitar cast error
  SELECT user_id INTO v_user_id
  FROM auth.sessions
  WHERE id::text = p_session_id::text;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  -- Eliminar refresh tokens con cast a text
  DELETE FROM auth.refresh_tokens
  WHERE session_id::text = p_session_id::text;

  -- Eliminar la sesión
  DELETE FROM auth.sessions
  WHERE id::text = p_session_id::text;

  RETURN 'OK';
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_single_session(UUID) TO authenticated;
SELECT 'OK: revoke_single_session recreada' AS resultado;
