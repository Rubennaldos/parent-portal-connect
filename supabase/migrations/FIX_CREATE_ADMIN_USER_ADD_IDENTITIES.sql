-- =============================================================================
-- FIX CRÍTICO: create_admin_user — agrega INSERT en auth.identities
-- SIN esta fila, el usuario se crea pero NO puede iniciar sesión:
--   → "Database error querying schema"
--
-- Si el SQL Editor da "unterminated dollar-quoted string", NO pegues solo una
-- parte del archivo: ejecuta en orden los archivos más cortos:
--   1) FIX_IDENTITIES_BACKFILL_ONLY.sql
--   2) FIX_CREATE_ADMIN_USER_FUNCTION_ONLY.sql
-- =============================================================================

-- PASO 1: Reparar usuarios YA CREADOS que les falta su identidad
-- (Esto soluciona a Norma, Matías o cualquier admin creado antes de este fix)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  u.id,                                     -- identities.id es UUID en esta instancia
  u.id,
  jsonb_build_object(
    'sub',   u.id::text,
    'email', u.email
  ),
  'email',
  u.email,
  u.created_at,
  u.created_at,
  u.created_at
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities i WHERE i.user_id = u.id
)
  AND u.aud = 'authenticated';              -- solo usuarios de la app, no el service_role

-- PASO 2: Reemplazar la función con la versión corregida
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_admin_user(text, text, text, text);
DROP FUNCTION IF EXISTS public.create_admin_user(text, text, text, text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.create_admin_user(
  p_email      text,
  p_password   text,
  p_full_name  text,
  p_role       text    DEFAULT 'admin_general',
  p_school_id  uuid    DEFAULT NULL,
  p_pos_number text    DEFAULT NULL,
  p_dmi        text    DEFAULT NULL,
  p_phone      text    DEFAULT NULL
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
  -- ── Verificar email duplicado ──────────────────────────────────────────────
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = lower(trim(p_email));

  IF v_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'El email ya está registrado. Si el usuario no aparece en la lista, espera unos segundos y recarga la página.'
    );
  END IF;

  SELECT instance_id INTO v_instance_id
  FROM auth.users
  WHERE instance_id IS NOT NULL
    AND instance_id <> '00000000-0000-0000-0000-000000000000'::uuid
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'No se pudo obtener instance_id del proyecto. Crea primero un usuario desde Auth (panel o app) y vuelve a intentar.'
    );
  END IF;

  -- ── Generar UUID y contraseña cifrada ─────────────────────────────────────
  v_user_id            := extensions.uuid_generate_v4();
  v_encrypted_password := extensions.crypt(p_password, extensions.gen_salt('bf'));

  -- ── 1. Insertar en auth.users ─────────────────────────────────────────────
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

  -- ── 2. Insertar en auth.identities (ESTE ERA EL BUG) ─────────────────────
  --    Sin esta fila, signInWithPassword lanza "Database error querying schema"
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

  -- ── 3. Crear / actualizar el perfil ───────────────────────────────────────
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

-- ── Verificación final ────────────────────────────────────────────────────────
-- Muestra los usuarios que aún no tendrían identidad (debe ser 0 filas)
SELECT u.email, u.id
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
  AND u.aud = 'authenticated';
