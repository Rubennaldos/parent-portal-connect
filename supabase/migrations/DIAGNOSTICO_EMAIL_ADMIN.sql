-- =============================================================================
-- DIAGNÓSTICO: ¿Existe o no un admin por email?
-- Cambia el email en las 3 consultas si hace falta.
-- =============================================================================

-- 1) ¿Está en login de Supabase (auth)?
SELECT id, email, email_confirmed_at, created_at
FROM auth.users
WHERE lower(email) = lower('matiaslogistica@limacafe28.com');

-- 2) ¿Tiene fila en perfiles de la app?
SELECT id, email, full_name, role, created_at
FROM public.profiles
WHERE lower(email) = lower('matiaslogistica@limacafe28.com');

-- 3) ¿Hay usuario en auth pero SIN perfil? (raro, pero útil)
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE lower(u.email) = lower('matiaslogistica@limacafe28.com')
  AND p.id IS NULL;

-- Interpretación:
-- Las 3 consultas vacías  → Matías nunca quedó creado. Ejecuta FIX_CREATE_ADMIN_USER_ON_CONFLICT.sql
--                          y créalo otra vez desde el panel (mismo email y contraseña nueva).
-- (1) con fila y (2) vacía → Usuario en auth sin perfil. Revisar SYNC_MISSING_PROFILES_FROM_AUTH.sql
--                            o crear perfil manualmente (no borrar sin saber).
-- (2) con fila              → El perfil existe; el problema era solo la pantalla o la lista que no refrescó.
