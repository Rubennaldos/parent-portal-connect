-- =============================================================================
-- REPARACIÓN CONTROLADA: quispe@limacafe28.com
-- Archivo: 20260602_repair_quispe_purge_recreate.sql
-- Fecha  : 2026-06-02
--
-- CONTEXTO (data real confirmada):
--   - auth.identities SÍ existe (user_id = id = eabc9ea2-5ca4-4948-8867-91366fb452c3)
--   - El 500 "Database error querying schema" NO es por falta de identidad.
--   - Causa probable: registro auth.users corrupto del 2026-05-20 (RPC legacy):
--       * instance_id = 00000000-0000-0000-0000-000000000000
--       * encrypted_password con formato distinto al de GoTrue
--       * columnas/token fields vacíos o inconsistentes con el esquema actual
--
-- ESTRATEGIA: borrón y cuenta nueva vía create_admin_user (canónica del repo).
-- NO toca Vercel ni React.
--
-- INSTRUCCIONES:
--   1) Ejecutar BLOQUE 0 (solo lectura) y revisar resultados.
--   2) Ajustar variables en BLOQUE 1 (rol, contraseña, sede).
--   3) Ejecutar BLOQUE 1 → 4 en una sola corrida en SQL Editor (service role).
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 0 — DIAGNÓSTICO FORENSE (SOLO LECTURA)
-- Copiar resultados antes de purgar.
-- ══════════════════════════════════════════════════════════════════════════════

-- 0.1 auth.users completo
SELECT '0.1 auth.users' AS paso,
       u.id,
       u.email,
       u.role,
       u.aud,
       u.instance_id,
       u.instance_id = '00000000-0000-0000-0000-000000000000'::uuid AS instance_id_invalido,
       u.email_confirmed_at IS NOT NULL AS email_confirmado,
       u.encrypted_password IS NOT NULL AS tiene_password,
       left(u.encrypted_password, 4) AS hash_prefijo,
       u.banned_until,
       u.deleted_at,
       u.raw_app_meta_data,
       u.raw_user_meta_data,
       u.last_sign_in_at,
       u.created_at
FROM auth.users u
WHERE u.id = 'eabc9ea2-5ca4-4948-8867-91366fb452c3'::uuid;

-- 0.2 auth.identities (debe existir 1 fila email)
SELECT '0.2 auth.identities' AS paso, i.*
FROM auth.identities i
WHERE i.user_id = 'eabc9ea2-5ca4-4948-8867-91366fb452c3'::uuid;

-- 0.3 public.profiles — ROL vs CHECK constraint (rol inválido = fallos en INSERT/UPDATE, no en login directo)
SELECT '0.3 public.profiles' AS paso,
       p.id,
       p.email,
       p.full_name,
       p.role,
       p.school_id,
       s.name AS sede_nombre,
       p.is_active,
       p.pos_number,
       p.created_at,
       CASE
         WHEN p.role IS NULL THEN 'ROL_NULL'
         WHEN NOT EXISTS (
           SELECT 1
           FROM pg_constraint c
           WHERE c.conrelid = 'public.profiles'::regclass
             AND c.conname = 'profiles_role_check'
             AND pg_get_constraintdef(c.oid) LIKE '%' || p.role || '%'
         ) THEN 'ROL_FUERA_DE_CHECK'
         ELSE 'ROL_OK_SEGUN_CHECK'
       END AS estado_rol
FROM public.profiles p
LEFT JOIN public.schools s ON s.id = p.school_id
WHERE p.id = 'eabc9ea2-5ca4-4948-8867-91366fb452c3'::uuid;

-- 0.4 Definición actual del CHECK de roles
SELECT '0.4 profiles_role_check' AS paso,
       pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND conname = 'profiles_role_check';

-- 0.5 Triggers en auth.users (solo AFTER INSERT en este proyecto; NO corren en login)
SELECT '0.5 triggers auth.users' AS paso,
       tgname,
       CASE tgenabled
         WHEN 'O' THEN 'enabled'
         WHEN 'D' THEN 'disabled'
         ELSE tgenabled::text
       END AS estado,
       pg_get_triggerdef(oid) AS definicion
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND NOT tgisinternal;

-- 0.6 Sedes disponibles (para elegir school_id en recreación)
SELECT '0.6 schools' AS paso, id, name, code
FROM public.schools
ORDER BY name;

-- 0.7 Referencia: sede de adminjbl (ajustar si Quispe pertenece a otra sede)
SELECT '0.7 ref adminjbl' AS paso, p.email, p.role, p.school_id, s.name AS sede
FROM public.profiles p
LEFT JOIN public.schools s ON s.id = p.school_id
WHERE lower(p.email) = lower('adminjbl@limacafe28.com');


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — PREPARACIÓN (constraint de roles + función RPC actualizada)
-- Idempotente. Alinea roles Tuqi POS con admin_sede, cajero legacy, etc.
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
      'admin_sede',
      'supervisor_red',
      'almacenero',
      'operador_caja',
      'operador_cocina',
      'cajero',
      'contadora',
      'parent',
      'teacher'
    ));
END $$;

-- pgcrypto en public (mismo esquema que validate_admin_password)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Asegurar create_admin_user canónica (auth.users + auth.identities + profiles)
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
      'error',   'El email ya está registrado. Ejecuta primero la purga (BLOQUE 2).'
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
  -- Coste 10 = bcrypt.DefaultCost de GoTrue (gen_salt('bf') solo usa coste 6 → login puede fallar)
  v_encrypted_password := crypt(p_password, gen_salt('bf', 10));

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
    id, email, full_name, role, school_id, created_at, updated_at, is_active
  ) VALUES (
    v_user_id,
    lower(trim(p_email)),
    p_full_name,
    p_role,
    p_school_id,
    v_now, v_now,
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = EXCLUDED.full_name,
    role       = EXCLUDED.role,
    school_id  = COALESCE(EXCLUDED.school_id, profiles.school_id),
    is_active  = true,
    updated_at = v_now;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email',   lower(trim(p_email)),
    'role',    p_role
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
-- BLOQUE 2 — PURGA CONTROLADA del usuario corrupto
-- Orden: hijos → profiles → identities → auth.users
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_user_id uuid := 'eabc9ea2-5ca4-4948-8867-91366fb452c3'::uuid;
  v_email   text := 'quispe@limacafe28.com';
BEGIN
  -- Módulos / permisos por usuario (si existen)
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_modules') THEN
    DELETE FROM public.user_modules WHERE user_id = v_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_school_modules') THEN
    DELETE FROM public.user_school_modules WHERE user_id = v_user_id;
  END IF;

  -- Perfiles extendidos
  DELETE FROM public.parent_profiles WHERE user_id = v_user_id;
  DELETE FROM public.teacher_profiles WHERE id = v_user_id;

  -- Notificaciones in-app
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications') THEN
    DELETE FROM public.notifications WHERE user_id = v_user_id;
  END IF;

  -- Perfil principal
  DELETE FROM public.profiles WHERE id = v_user_id OR lower(email) = lower(v_email);

  -- Auth (identidad antes que users)
  DELETE FROM auth.identities WHERE user_id = v_user_id;
  DELETE FROM auth.users WHERE id = v_user_id OR lower(email) = lower(v_email);

  RAISE NOTICE 'Purga completada para % (id %)', v_email, v_user_id;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — RECREACIÓN LIMPIA
-- ⚠️ AJUSTAR ANTES DE EJECUTAR:
--   • p_password  → contraseña temporal (el usuario la cambia después)
--   • p_role      → rol real en Tuqi POS
--   • p_school_id → NULL para admin_general/supervisor_red; UUID obligatorio para gestor_unidad/admin_sede/operadores
-- ══════════════════════════════════════════════════════════════════════════════

SELECT public.create_admin_user(
  p_email      => 'quispe@limacafe28.com',
  p_password   => 'quispe123',  -- ← CAMBIAR
  p_full_name  => 'Quispe',                        -- ← Ajustar nombre visible
  p_role       => 'admin_general',                 -- ← CAMBIAR si aplica: admin_sede, gestor_unidad, operador_caja, etc.
  p_school_id  => NULL                             -- ← O UUID de sede, ej.:
  -- p_school_id  => (SELECT id FROM public.schools WHERE code = 'SGM' LIMIT 1),
  -- p_school_id  => (SELECT school_id FROM public.profiles WHERE email = 'adminjbl@limacafe28.com' LIMIT 1),
) AS resultado_creacion;


-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 — VERIFICACIÓN POST-REPARACIÓN
-- ══════════════════════════════════════════════════════════════════════════════

-- Tras BLOQUE 3: la columna resultado_creacion debe mostrar "success": true
SELECT '4.1 auth.users nuevo' AS paso,
       u.id,
       u.email,
       u.instance_id,
       u.instance_id <> '00000000-0000-0000-0000-000000000000'::uuid AS instance_id_ok,
       u.email_confirmed_at IS NOT NULL AS confirmado,
       left(u.encrypted_password, 7) AS hash_prefijo,
       (u.encrypted_password = crypt('quispe123', u.encrypted_password)) AS password_ok_quispe123
FROM auth.users u
WHERE lower(u.email) = lower('quispe@limacafe28.com');

SELECT '4.2 auth.identities nuevo' AS paso, i.provider, i.provider_id, i.user_id, i.id
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE lower(u.email) = lower('quispe@limacafe28.com');

SELECT '4.3 public.profiles nuevo' AS paso,
       p.id,
       p.email,
       p.full_name,
       p.role,
       p.school_id,
       s.name AS sede,
       p.is_active
FROM public.profiles p
LEFT JOIN public.schools s ON s.id = p.school_id
WHERE lower(p.email) = lower('quispe@limacafe28.com');

-- ══════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 — CONTRASEÑA: el SQL con crypt() NO arregla el login en producción
-- GoTrue solo acepta hashes creados por Admin API o Dashboard.
-- Usar: 20260602_reset_password_quispe.sql (diagnóstico) + una de estas opciones:
--   • Dashboard → Authentication → Users → quispe → Reset password
--   • Panel admin (superadmin) → función reset-user-password
--   • curl Admin API (ver comentarios al final de reset_password_quispe.sql)
-- ══════════════════════════════════════════════════════════════════════════════
