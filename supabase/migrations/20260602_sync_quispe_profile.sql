-- =============================================================================
-- ⚠️ CORREO INCORRECTO PARA ESTE CASO — ver 20260602_sync_quispejlb_admin.sql
-- El usuario real en Auth es: quispejlb@limacafe28.com (Anais Quispe)
-- =============================================================================
-- SINCRONIZAR quispe@limacafe28.com: Auth → public.profiles
-- Ejecutar TODO en Supabase → SQL Editor
--
-- Por qué no aparece en "Gestión de Usuarios":
--   La UI busca en public.profiles (RPC buscar_usuarios_admin), NO en auth.users.
--   Si solo existe en Auth, el panel dice "no hay usuarios" aunque el correo exista en Auth.
--
-- Si el correo no es buzón real: NO uses "Send recovery email".
--   Usa Dashboard → Authentication → Users → quispe → Update user → Password.
-- =============================================================================

-- ── 1) Diagnóstico ───────────────────────────────────────────────────────────
SELECT 'auth.users' AS fuente, u.id, u.email, u.email_confirmed_at IS NOT NULL AS confirmado
FROM auth.users u
WHERE lower(u.email) = lower('quispe@limacafe28.com');

SELECT 'public.profiles' AS fuente, p.id, p.email, p.role, p.full_name, p.is_active
FROM public.profiles p
WHERE lower(p.email) = lower('quispe@limacafe28.com')
   OR p.id IN (SELECT id FROM auth.users WHERE lower(email) = lower('quispe@limacafe28.com'));

-- ── 2) Crear perfil si falta (desde auth.users) ──────────────────────────────
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
    'Quispe'
  ),
  COALESCE(
    NULLIF(trim(au.raw_user_meta_data->>'role'), ''),
    'admin_general'
  ),
  true,
  COALESCE(au.created_at, now()),
  now()
FROM auth.users au
WHERE lower(au.email) = lower('quispe@limacafe28.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = au.id
  );

-- Si ya existía perfil pero con email/rol incorrecto, alinear:
UPDATE public.profiles p
SET
  email      = lower('quispe@limacafe28.com'),
  full_name  = COALESCE(NULLIF(trim(p.full_name), ''), 'Quispe'),
  role       = COALESCE(p.role, 'admin_general'),
  is_active  = true,
  updated_at = now()
FROM auth.users au
WHERE au.id = p.id
  AND lower(au.email) = lower('quispe@limacafe28.com');

-- ── 3) Verificación (debe devolver 1 fila en auth Y 1 en profiles) ───────────
SELECT 'VERIF auth' AS paso, count(*) AS filas FROM auth.users WHERE lower(email) = lower('quispe@limacafe28.com');
SELECT 'VERIF profiles' AS paso, count(*) AS filas FROM public.profiles WHERE lower(email) = lower('quispe@limacafe28.com');

SELECT 'VERIF busqueda admin' AS paso, *
FROM public.buscar_usuarios_admin('quispe@limacafe28.com', 'all', 0, 10);

-- ── 4) Contraseña: NO usar SQL crypt() — usar Dashboard o Admin API ─────────
-- Dashboard → Authentication → Users → quispe@limacafe28.com
-- → Update user → Password: quispe123 → Save (sin enviar correo)
--
-- O PowerShell (service_role + user id del paso 1):
-- PUT https://duxqzozoahvrvqseinji.supabase.co/auth/v1/admin/users/{USER_ID}
-- Body: {"password":"quispe123","email_confirm":true}

SELECT '✅ Recarga Gestión de Usuarios y busca quispe@limacafe28.com' AS siguiente_paso;
