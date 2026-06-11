-- =============================================================================
-- CREAR cuenta NUEVA: quispe@limacafe28.com como Admin General
--
-- NO confundir con: quispejlb@limacafe28.com (Anais Quispe — otra cuenta)
--
-- PASOS:
--   1) Ejecutar BLOQUE 0 (diagnóstico)
--   2) Si ya existe basura → BLOQUE 1 (purga solo quispe@)
--   3) BLOQUE 2 (crear con create_admin_user)
--   4) Dashboard → Authentication → quispe@ → Update user → Password (Admin API)
--   5) Recargar Gestión de Usuarios y buscar quispe@limacafe28.com
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 0 — DIAGNÓSTICO
-- ══════════════════════════════════════════════════════════════════════════════

SELECT '0.1 auth quispe@' AS paso, u.id, u.email, u.created_at
FROM auth.users u
WHERE lower(u.email) = lower('quispe@limacafe28.com');

SELECT '0.2 auth quispejlb (otra cuenta)' AS paso, u.id, u.email
FROM auth.users u
WHERE lower(u.email) = lower('quispejlb@limacafe28.com');

SELECT '0.3 profiles quispe@' AS paso, p.id, p.email, p.role, p.full_name
FROM public.profiles p
WHERE lower(p.email) = lower('quispe@limacafe28.com');

-- instance_id de referencia (quispejlb u otro usuario Auth)
SELECT '0.4 instance_id ref' AS paso, email, instance_id
FROM auth.users
WHERE lower(email) IN (lower('quispejlb@limacafe28.com'), lower('superadmin@limacafe28.com'))
   OR email IS NOT NULL
ORDER BY CASE WHEN lower(email) = lower('quispejlb@limacafe28.com') THEN 0 ELSE 1 END
LIMIT 3;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — PURGA SOLO quispe@limacafe28.com (si hay restos corruptos)
-- No toca quispejlb@limacafe28.com
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_email text := 'quispe@limacafe28.com';
  v_ids   uuid[];
BEGIN
  SELECT array_agg(DISTINCT x.id) INTO v_ids
  FROM (
    SELECT id FROM auth.users WHERE lower(email) = lower(v_email)
    UNION
    SELECT id FROM public.profiles WHERE lower(email) = lower(v_email)
  ) x;

  IF v_ids IS NULL THEN
    RAISE NOTICE 'No hay restos de % — saltar a BLOQUE 2', v_email;
    RETURN;
  END IF;

  DELETE FROM public.user_modules WHERE user_id = ANY(v_ids);
  DELETE FROM public.parent_profiles WHERE user_id = ANY(v_ids);
  DELETE FROM public.teacher_profiles WHERE id = ANY(v_ids);
  DELETE FROM public.profiles WHERE id = ANY(v_ids) OR lower(email) = lower(v_email);
  DELETE FROM auth.identities WHERE user_id = ANY(v_ids);
  DELETE FROM auth.users WHERE id = ANY(v_ids) OR lower(email) = lower(v_email);

  RAISE NOTICE 'Purga completada para %', v_email;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — CREAR Admin General (Auth + identities + profiles)
-- Cambiar p_password antes de ejecutar.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
  END IF;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN (
      'superadmin', 'admin_general', 'gestor_unidad', 'admin_sede',
      'supervisor_red', 'almacenero', 'operador_caja', 'operador_cocina',
      'cajero', 'contadora', 'parent', 'teacher'
    ));
END $$;

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
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email ya registrado. Ejecuta BLOQUE 1 (purga) primero.');
  END IF;

  -- Copiar instance_id de un usuario existente (p. ej. quispejlb); si todos son NULL → ceros (válido en Supabase hosted)
  SELECT COALESCE(
    (SELECT instance_id FROM auth.users WHERE lower(email) = lower('quispejlb@limacafe28.com') LIMIT 1),
    (SELECT instance_id FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ) INTO v_instance_id;

  v_user_id            := extensions.uuid_generate_v4();
  v_encrypted_password := crypt(p_password, gen_salt('bf', 10));

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, role, aud
  ) VALUES (
    v_user_id, v_instance_id, lower(trim(p_email)), v_encrypted_password,
    v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', p_role),
    v_now, v_now, 'authenticated', 'authenticated'
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', lower(trim(p_email))),
    'email', lower(trim(p_email)), v_now, v_now, v_now
  );

  -- El trigger on_auth_user_created ya puede haber creado el perfil → UPSERT
  INSERT INTO public.profiles (
    id, email, full_name, role, school_id, is_active, created_at, updated_at
  ) VALUES (
    v_user_id, lower(trim(p_email)), p_full_name, p_role, p_school_id,
    true, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    school_id  = COALESCE(EXCLUDED.school_id, profiles.school_id),
    is_active  = true,
    updated_at = v_now;

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'email', lower(trim(p_email)), 'role', p_role);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Si falló con profiles_pkey → usar 20260602_fix_quispe_partial_create.sql (NO repetir BLOQUE 2)

-- ⚠️ CAMBIAR contraseña temporal aquí (solo si quispe@ NO existe aún en auth):
SELECT public.create_admin_user(
  p_email     => 'quispe@limacafe28.com'::text,
  p_password  => 'quispe123'::text,
  p_full_name => 'Quispe'::text,
  p_role      => 'admin_general'::text,
  p_school_id => NULL::uuid
) AS resultado_creacion;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — VERIFICACIÓN (Gestión de Usuarios lee profiles)
-- ══════════════════════════════════════════════════════════════════════════════

SELECT '3.1 auth' AS paso, id, email FROM auth.users
WHERE lower(email) = lower('quispe@limacafe28.com');

SELECT '3.2 profiles' AS paso, id, email, role, full_name FROM public.profiles
WHERE lower(email) = lower('quispe@limacafe28.com');

SELECT '3.3 busqueda UI' AS paso, *
FROM public.buscar_usuarios_admin('quispe@limacafe28.com', 'admin_general', 0, 10);

-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 — CONTRASEÑA QUE SÍ FUNCIONA EN LOGIN (obligatorio tras crear)
-- El hash SQL a menudo NO sirve para signIn → usar Dashboard:
--   Authentication → Users → quispe@limacafe28.com → Update user → Password → Save
-- Login portal: quispe@limacafe28.com + esa contraseña
-- ══════════════════════════════════════════════════════════════════════════════

SELECT '✅ Si resultado_creacion.success=true, define password en Dashboard y prueba login' AS listo;
