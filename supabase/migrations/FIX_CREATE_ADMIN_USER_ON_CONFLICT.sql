-- =============================================================================
-- FIX: create_admin_user — usa ON CONFLICT para no chocar con el trigger
-- automático de Supabase que crea la fila en profiles al crear el auth user.
-- Se hace DROP primero porque el tipo de retorno cambió (text → jsonb).
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_admin_user(text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_admin_user(
  p_email     text,
  p_password  text,
  p_full_name text,
  p_role      text DEFAULT 'admin_general'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
  v_encrypted_password text;
  v_now timestamptz := now();
BEGIN
  -- Verificar que no exista ya un usuario con ese email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = lower(trim(p_email));

  IF v_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'El email ya está registrado. Si el usuario no aparece en la lista, espera unos segundos y recarga la página.'
    );
  END IF;

  -- Generar UUID y hash de contraseña
  v_user_id := extensions.uuid_generate_v4();
  v_encrypted_password := extensions.crypt(p_password, extensions.gen_salt('bf'));

  -- Crear el usuario en auth.users
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    role,
    aud
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    lower(trim(p_email)),
    v_encrypted_password,
    v_now,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    v_now,
    v_now,
    'authenticated',
    'authenticated'
  );

  -- Crear / actualizar el perfil.
  -- ON CONFLICT DO UPDATE: si el trigger ya creó la fila, la actualizamos
  -- sin error en vez de explotar con "duplicate key".
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    lower(trim(p_email)),
    p_full_name,
    p_role,
    v_now,
    v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    updated_at = v_now;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email',   lower(trim(p_email))
  );

EXCEPTION
  WHEN unique_violation THEN
    -- Si el email duplicado es en auth.users (rara vez llega aquí por el check de arriba)
    RETURN jsonb_build_object(
      'success', false,
      'error',   'El email ya está registrado en el sistema.'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   SQLERRM
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_user(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_admin_user(text, text, text, text) TO authenticated;
