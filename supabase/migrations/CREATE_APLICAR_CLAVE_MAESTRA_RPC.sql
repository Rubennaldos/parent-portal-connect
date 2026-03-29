-- ============================================================
-- RPC: aplicar_clave_maestra
-- Resetea la contraseña en auth.users (mismo patrón que create_admin_user).
-- Ejecutar en SQL Editor de Supabase si aún no existe la función.
-- ============================================================

CREATE OR REPLACE FUNCTION public.aplicar_clave_maestra(
  p_email TEXT,
  p_clave TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = lower(trim(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf')),
    updated_at = now()
  WHERE id = v_user_id;

  RETURN TRUE;

EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_clave_maestra(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.aplicar_clave_maestra(TEXT, TEXT) TO authenticated;
