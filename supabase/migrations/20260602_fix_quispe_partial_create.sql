-- =============================================================================
-- REPARAR creación a medias de quispe@limacafe28.com
-- (error: duplicate key profiles_pkey — Auth + trigger ya crearon el perfil)
-- Ejecutar TODO. Luego Dashboard → Password para login.
-- =============================================================================

-- 1) Asegurar rol Admin General en profiles
UPDATE public.profiles p
SET
  role       = 'admin_general',
  full_name  = COALESCE(NULLIF(trim(p.full_name), ''), 'Quispe'),
  email      = lower('quispe@limacafe28.com'),
  is_active  = true,
  updated_at = now()
FROM auth.users au
WHERE au.id = p.id
  AND lower(au.email) = lower('quispe@limacafe28.com');

-- 2) Identidad email si falta (necesaria para login)
INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
SELECT
  au.id,
  au.id,
  jsonb_build_object('sub', au.id::text, 'email', au.email),
  'email',
  au.email,
  COALESCE(au.last_sign_in_at, au.created_at, now()),
  COALESCE(au.created_at, now()),
  COALESCE(au.updated_at, now())
FROM auth.users au
WHERE lower(au.email) = lower('quispe@limacafe28.com')
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = au.id);

-- 3) Verificación
SELECT 'auth' AS paso, id, email FROM auth.users
WHERE lower(email) = lower('quispe@limacafe28.com');

SELECT 'profiles' AS paso, id, email, role, full_name FROM public.profiles
WHERE lower(email) = lower('quispe@limacafe28.com');

SELECT 'identities' AS paso, provider, provider_id FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE lower(u.email) = lower('quispe@limacafe28.com');

SELECT 'busqueda UI' AS paso, *
FROM public.buscar_usuarios_admin('quispe@limacafe28.com', 'admin_general', 0, 5);

-- 4) Contraseña: Dashboard → Authentication → quispe@ → Update user → Password

SELECT '✅ Listo — define password en Dashboard y prueba login' AS listo;
