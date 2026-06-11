-- =============================================================================
-- CORRECCIÓN: Anais Quispe — correo REAL en Auth
--
--   ❌ NO usar: quispe@limacafe28.com  (no es el usuario del panel Auth)
--   ✅ SÍ usar: quispejlb@limacafe28.com
--   UID Auth:  b7935adf-338f-424c-b7f4-52fe8aeddb4a
--
-- La app "Gestión de Usuarios" solo lista public.profiles.
-- Ejecutar TODO en SQL Editor.
-- =============================================================================

-- 1) Diagnóstico
SELECT 'auth' AS tabla, u.id, u.email, u.raw_user_meta_data
FROM auth.users u
WHERE lower(u.email) IN (lower('quispejlb@limacafe28.com'), lower('quispe@limacafe28.com'));

SELECT 'profiles' AS tabla, p.id, p.email, p.role, p.full_name, p.is_active
FROM public.profiles p
WHERE lower(p.email) IN (lower('quispejlb@limacafe28.com'), lower('quispe@limacafe28.com'))
   OR p.id = 'b7935adf-338f-424c-b7f4-52fe8aeddb4a'::uuid;

-- 2) Crear o actualizar perfil como Admin General
INSERT INTO public.profiles (
  id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  updated_at
)
SELECT
  au.id,
  lower(trim(au.email)),
  COALESCE(
    NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
    'Anais Quispe'
  ),
  'admin_general',
  true,
  COALESCE(au.created_at, now()),
  now()
FROM auth.users au
WHERE lower(au.email) = lower('quispejlb@limacafe28.com')
ON CONFLICT (id) DO UPDATE SET
  email      = EXCLUDED.email,
  full_name  = COALESCE(NULLIF(trim(EXCLUDED.full_name), ''), profiles.full_name, 'Anais Quispe'),
  role       = 'admin_general',
  is_active  = true,
  updated_at = now();

-- 3) Verificación (debe aparecer en buscar_usuarios_admin)
SELECT 'VERIF profiles' AS paso, id, email, role, full_name
FROM public.profiles
WHERE id = 'b7935adf-338f-424c-b7f4-52fe8aeddb4a'::uuid;

SELECT 'VERIF busqueda' AS paso, *
FROM public.buscar_usuarios_admin('quispejlb', 'all', 0, 10);

-- 4) Contraseña (Dashboard, sin correo):
-- Authentication → Users → quispejlb@limacafe28.com → Update user → Password
--
-- Login en portal: quispejlb@limacafe28.com  (NO quispe@limacafe28.com)

SELECT '✅ Recarga Superadmin → Gestión de Usuarios → busca quispejlb' AS listo;
