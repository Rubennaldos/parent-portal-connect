-- Ejecutar SEGUNDO (redefine create_admin_user con INSERT en auth.identities).
-- Usa $function$ en lugar de $$ para evitar errores de "unterminated dollar-quoted string"
-- en algunos pegados al SQL Editor.

DROP FUNCTION IF EXISTS public.create_admin_user(text, text, text, text);
DROP FUNCTION IF EXISTS public.create_admin_user(text, text, text, text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.create_admin_user(
  p_email      text,
  p_password   text,
  p_full_name  text,
  p_role       text DEFAULT 'admin_general',
  p_school_id  uuid DEFAULT NULL,
  p_pos_number text DEFAULT NULL,
  p_dmi        text DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $function$
DECLARE
  v_user_id            uuid;
  v_instance_id        uuid;
  v_encrypted_password text;
  v_now                timestamptz := now();
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = lower(trim(p_email));

  IF v_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'El email ya está registrado.'
    );
  END IF;

  -- instance_id real del proyecto (mismo que usuarios creados por Auth API)
  SELECT instance_id INTO v_instance_id
  FROM auth.users
  WHERE instance_id IS NOT NULL
    AND instance_id <> '00000000-0000-0000-0000-000000000000'::uuid
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'No se pudo obtener instance_id del proyecto. Crea primero un usuario desde Supabase Auth o desde la app (Edge Function) y vuelve a intentar.'
    );
  END IF;

  v_user_id            := extensions.uuid_generate_v4();
  v_encrypted_password := extensions.crypt(p_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    id, instance_id,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    role, aud
  ) VALUES (
    v_user_id,
    v_instance_id,
    lower(trim(p_email)),
    v_encrypted_password,
    v_now,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    v_now, v_now,
    'authenticated', 'authenticated'
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_user_id,
    jsonb_build_object(
      'sub',   v_user_id::text,
      'email', lower(trim(p_email))
    ),
    'email',
    lower(trim(p_email)),
    v_now,
    v_now,
    v_now
  );

  INSERT INTO public.profiles (
    id, email, full_name, role,
    school_id,
    created_at, updated_at
  ) VALUES (
    v_user_id,
    lower(trim(p_email)),
    p_full_name,
    p_role,
    p_school_id,
    v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    school_id  = COALESCE(EXCLUDED.school_id, profiles.school_id),
    updated_at = v_now;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email',   lower(trim(p_email))
  );

EXCEPTION
  WHEN unique_violation THEN
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
$function$;

REVOKE ALL ON FUNCTION public.create_admin_user(text, text, text, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_admin_user(text, text, text, text, uuid, text, text, text) TO authenticated;
