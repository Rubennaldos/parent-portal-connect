-- ============================================================
-- Sincronizar perfiles faltantes (usuarios en Auth sin fila en profiles)
-- Si una mamá/padre no aparece en "Gestión de Usuarios", suele ser porque
-- tiene cuenta en Auth pero nunca se creó su fila en public.profiles.
-- Ejecutar en Supabase → SQL Editor (como postgres / service role).
-- ============================================================

-- 1) DIAGNÓSTICO: listar usuarios en auth.users que NO tienen perfil
SELECT
  au.id,
  au.email,
  au.raw_user_meta_data->>'full_name' AS full_name_meta,
  au.created_at
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ORDER BY au.email;

-- 2) CREAR perfiles para esos usuarios (rol = parent por defecto, email y nombre desde Auth)
INSERT INTO public.profiles (id, email, role, full_name, created_at, updated_at)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'role', 'parent'),
  NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''),
  au.created_at,
  NOW()
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  full_name = COALESCE(NULLIF(TRIM(EXCLUDED.full_name), ''), profiles.full_name),
  updated_at = NOW();

-- 3) Verificar: buscar un email concreto (cambiar el email si quieres)
-- SELECT id, email, full_name, role FROM public.profiles WHERE email ILIKE '%penakaren003%';
