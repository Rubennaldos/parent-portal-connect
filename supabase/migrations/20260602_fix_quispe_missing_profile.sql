-- =============================================================================
-- CAUSA RAÍZ CONFIRMADA (diagnóstico 2026-06-02)
--
--   auth.users  → quispe@limacafe28.com  id = dc12cf1a-1db3-4cbe-9d8b-b0f2fd8d59d3  ✅
--   profiles    → SIN FILA (profile_id NULL, ids_coinciden NULL)                 ❌
--
-- Por eso useRole → PGRST116 → role = 'parent' → formulario de padre.
-- check_is_admin y RLS están bien; falta la fila en public.profiles.
--
-- Ejecutar TODO. Luego cerrar sesión y volver a entrar.
-- =============================================================================

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
  COALESCE(NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''), 'Quispe'),
  'admin_general',
  true,
  COALESCE(au.created_at, now()),
  now()
FROM auth.users au
WHERE lower(au.email) = lower('quispe@limacafe28.com')
ON CONFLICT (id) DO UPDATE SET
  email      = EXCLUDED.email,
  role       = 'admin_general',
  full_name  = COALESCE(EXCLUDED.full_name, profiles.full_name),
  is_active  = true,
  updated_at = now();

-- Verificación (debe coincidir auth id = profile id)
SELECT
  'VERIF' AS bloque,
  au.id AS auth_user_id,
  p.id AS profile_id,
  au.id = p.id AS ids_coinciden,
  p.email,
  p.role,
  p.is_active
FROM auth.users au
JOIN public.profiles p ON p.id = au.id
WHERE lower(au.email) = lower('quispe@limacafe28.com');

SELECT 'busqueda UI' AS bloque, *
FROM public.buscar_usuarios_admin('quispe@limacafe28.com', 'admin_general', 0, 5);

SELECT '✅ Cerrar sesión → login quispe@ → debe ir a /dashboard' AS siguiente_paso;
