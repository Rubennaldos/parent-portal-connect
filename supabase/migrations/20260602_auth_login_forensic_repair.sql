-- =============================================================================
-- REPARACIÓN FORENSE: Auth 500 "Database error querying schema"
-- Archivo: 20260602_auth_login_forensic_repair.sql
-- Fecha  : 2026-06-02
--
-- CONTEXTO:
--   signInWithPassword falla con HTTP 500 y mensaje:
--   "AuthApiError: Database error querying schema"
--
-- CAUSA RAÍZ (documentada en este mismo repositorio):
--   Usuarios creados por RPC/manual sin fila en auth.identities y/o con
--   instance_id = '00000000-0000-0000-0000-000000000000'.
--   GoTrue no puede resolver la identidad al emitir el token → 500.
--
-- NO ES CAUSA:
--   - Migración branch_supply (20260601_*) — no toca auth.*
--   - Código React del login — el error viene del servidor Auth
--
-- ORDEN DE EJECUCIÓN:
--   Pegar y ejecutar TODO este archivo en el SQL Editor de Supabase (una vez).
--   Es idempotente: puede re-ejecutarse sin duplicar datos.
-- =============================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 0 — DIAGNÓSTICO (solo lectura; copiar resultados antes de reparar)
-- ══════════════════════════════════════════════════════════════════════════════

-- 0.1 Usuario afectado (cambiar email si necesitas otro)
SELECT '0.1 auth.users' AS paso, u.id, u.email, u.role, u.aud,
       u.instance_id,
       u.email_confirmed_at IS NOT NULL AS email_confirmado,
       u.encrypted_password IS NOT NULL AS tiene_password,
       u.banned_until, u.deleted_at
FROM auth.users u
WHERE lower(u.email) = lower('quispe@limacafe28.com');

-- 0.2 ¿Tiene identidad? (si 0 filas → CAUSA CONFIRMADA del 500)
SELECT '0.2 auth.identities' AS paso, i.*
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE lower(u.email) = lower('quispe@limacafe28.com');

-- 0.3 Perfil en public.profiles
SELECT '0.3 public.profiles' AS paso, p.id, p.email, p.full_name, p.role,
       p.school_id, p.is_active, p.created_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE lower(u.email) = lower('quispe@limacafe28.com');

-- 0.4 TODOS los usuarios sin identidad (huérfanos de login)
SELECT '0.4 huérfanos sin identidad' AS paso, u.email, u.id, u.created_at
FROM auth.users u
WHERE u.aud = 'authenticated'
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
ORDER BY u.created_at DESC;

-- 0.5 TODOS con instance_id en ceros
SELECT '0.5 instance_id inválido' AS paso, u.email, u.id, u.instance_id
FROM auth.users u
WHERE u.instance_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND u.aud = 'authenticated';

-- 0.6 Constraint actual de roles en profiles (puede bloquear CREACIÓN, no login)
SELECT '0.6 profiles_role_check' AS paso, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND conname = 'profiles_role_check';

-- 0.7 ¿Existe el trigger de sincronización?
SELECT '0.7 trigger auth' AS paso, tgname, tgenabled,
       pg_get_triggerdef(oid) AS definicion
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND NOT tgisinternal;


-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 1 — REPARAR USUARIOS HUÉRFANOS (auth.identities)
-- Origen del bug: SOLUCION_DEFINITIVA_RPC.sql / FIX_RPC_SIN_UPDATED_AT.sql
--   → INSERT en auth.users SIN auth.identities (líneas 59-96 aprox.)
-- Fix canónico ya existía en: FIX_IDENTITIES_BACKFILL_ONLY.sql
-- ══════════════════════════════════════════════════════════════════════════════

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
  u.id,
  u.id,
  jsonb_build_object(
    'sub',   u.id::text,
    'email', u.email
  ),
  'email',
  u.email,
  COALESCE(u.last_sign_in_at, u.created_at),
  u.created_at,
  u.updated_at
FROM auth.users u
WHERE u.aud = 'authenticated'
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 2 — REPARAR instance_id INVÁLIDO
-- Origen del bug: SOLUCION_DEFINITIVA_RPC.sql línea 79
--   instance_id hardcodeado a '00000000-0000-0000-0000-000000000000'
-- Fix canónico: FIX_AUTH_USERS_INSTANCE_ID.sql
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE auth.users AS u
SET instance_id = ref.instance_id
FROM (
  SELECT instance_id
  FROM auth.users
  WHERE instance_id IS NOT NULL
    AND instance_id <> '00000000-0000-0000-0000-000000000000'::uuid
  LIMIT 1
) AS ref
WHERE u.instance_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND u.aud = 'authenticated';


-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 3 — AMPLIAR profiles_role_check (roles usados en RLS/RPC pero ausentes)
-- Evita fallos al CREAR perfil (trigger o create_admin_user).
-- NO causa el 500 de login, pero deja perfiles inconsistentes.
-- ══════════════════════════════════════════════════════════════════════════════

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
      'superadmin',
      'admin_general',
      'gestor_unidad',
      'admin_sede',        -- usado en RLS y SchoolAdmin
      'supervisor_red',
      'almacenero',
      'operador_caja',
      'operador_cocina',
      'cajero',            -- alias legacy aún referenciado
      'contadora',
      'parent',
      'teacher'
    ));
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 4 — TRIGGER handle_new_user (sincroniza auth.users → public.profiles)
-- Archivo histórico: FIX_AUTH_TRIGGER_ROLES.sql
-- NOTA: Este trigger NO se ejecuta en LOGIN; solo en INSERT a auth.users.
-- Se reinstala para que signUp / Admin API sigan creando perfiles válidos.
-- ══════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role      text;
  v_full_name text;
BEGIN
  v_role := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'role'), ''),
    'parent'
  );

  v_full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_role,
    COALESCE(NEW.created_at, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = COALESCE(EXCLUDED.full_name, profiles.full_name),
    role       = EXCLUDED.role,
    updated_at = now();

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- No bloquear la creación en auth.users; registrar en logs de Postgres
    RAISE WARNING 'handle_new_user falló para %: % (SQLSTATE %)',
      NEW.email, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 5 — RPC create_admin_user (versión correcta con identities + instance_id)
-- Reemplaza versiones rotas de SOLUCION_DEFINITIVA_RPC.sql / FIX_RPC_SIN_UPDATED_AT.sql
-- Fuente canónica: FIX_CREATE_ADMIN_USER_FUNCTION_ONLY.sql
-- ══════════════════════════════════════════════════════════════════════════════

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

  SELECT instance_id INTO v_instance_id
  FROM auth.users
  WHERE instance_id IS NOT NULL
    AND instance_id <> '00000000-0000-0000-0000-000000000000'::uuid
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'No se pudo obtener instance_id del proyecto.'
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
    jsonb_build_object('full_name', p_full_name, 'role', p_role),
    v_now, v_now,
    'authenticated', 'authenticated'
  );

  -- LÍNEA CRÍTICA: sin esto → "Database error querying schema" en login
  INSERT INTO auth.identities (
    id, user_id, identity_data,
    provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', lower(trim(p_email))),
    'email',
    lower(trim(p_email)),
    v_now, v_now, v_now
  );

  INSERT INTO public.profiles (
    id, email, full_name, role, school_id, created_at, updated_at
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
    RETURN jsonb_build_object('success', false, 'error', 'El email ya está registrado.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_admin_user(text, text, text, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_admin_user(text, text, text, text, uuid, text, text, text) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 6 — VERIFICACIÓN POST-REPARACIÓN (debe quedar limpio)
-- ══════════════════════════════════════════════════════════════════════════════

SELECT 'VERIF: sin identidad' AS check_name, count(*) AS debe_ser_cero
FROM auth.users u
WHERE u.aud = 'authenticated'
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id);

SELECT 'VERIF: instance_id cero' AS check_name, count(*) AS debe_ser_cero
FROM auth.users u
WHERE u.instance_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND u.aud = 'authenticated';

SELECT 'VERIF: quispe identidad' AS check_name, u.email, i.provider, i.provider_id
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id
WHERE lower(u.email) = lower('quispe@limacafe28.com');

SELECT '✅ REPARACIÓN FORENSE AUTH COMPLETADA — Probar login en portal' AS resultado;
