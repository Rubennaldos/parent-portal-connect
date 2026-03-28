-- ============================================================
-- DIAGNÓSTICO PROFUNDO — por qué Matías no puede iniciar sesión
-- Ejecutar todo junto. Copiar y compartir los 4 resultados.
-- ============================================================

-- 1. Revisar auth.users completo para Matías
SELECT
  id,
  email,
  role,
  aud,
  email_confirmed_at,
  banned_until,
  deleted_at,
  encrypted_password IS NOT NULL AS tiene_password,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at
FROM auth.users
WHERE email = 'matiaslogistica@limacafe28.com';

-- 2. Revisar si existe el perfil en public.profiles
SELECT
  id,
  email,
  full_name,
  role,
  school_id,
  created_at
FROM public.profiles
WHERE id = '737b9b43-c5c6-4177-8b64-8068ed744e08';

-- 3. Revisar auth.identities con más detalle
SELECT
  id,
  user_id,
  provider,
  provider_id,
  identity_data,
  created_at
FROM auth.identities
WHERE user_id = '737b9b43-c5c6-4177-8b64-8068ed744e08';

-- 4. Ver si el rol en auth.users es correcto
-- (debe ser 'authenticated', NO 'service_role' ni nulo)
SELECT
  id,
  email,
  role AS role_auth_users,
  aud
FROM auth.users
WHERE email = 'matiaslogistica@limacafe28.com';
