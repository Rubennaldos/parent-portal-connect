-- =============================================================================
-- quispe@limacafe28.com NO aparece en Authentication
-- La transacción SQL probablemente hizo ROLLBACK al error profiles_pkey.
--
-- OPCIÓN A (recomendada): Dashboard → Authentication → Add user
--   Email: quispe@limacafe28.com | Password: (la que elijas) | Auto Confirm: ON
--   Luego ejecutar solo el BLOQUE B de este archivo.
--
-- OPCIÓN B: SQL completo abajo (purga huérfanos + crear de nuevo)
-- =============================================================================


-- ── BLOQUE A — Diagnóstico ─────────────────────────────────────────────────────
SELECT 'auth.users' AS fuente, id, email FROM auth.users
WHERE lower(email) = lower('quispe@limacafe28.com');

SELECT 'profiles huérfano' AS fuente, p.id, p.email, p.role FROM public.profiles p
WHERE lower(p.email) = lower('quispe@limacafe28.com')
   OR p.id NOT IN (SELECT id FROM auth.users);


-- ── BLOQUE B — Tras "Add user" en Dashboard (solo alinear profiles) ───────────
INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
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

SELECT 'VERIF UI' AS paso, * FROM public.buscar_usuarios_admin('quispe@limacafe28.com', 'admin_general', 0, 5);


-- ── BLOQUE C — Solo si prefieres 100% SQL (ejecutar TODO C, no repetir create viejo) ─
/*
DO $$
BEGIN
  DELETE FROM public.profiles WHERE lower(email) = lower('quispe@limacafe28.com');
  DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE lower(email) = lower('quispe@limacafe28.com'));
  DELETE FROM auth.users WHERE lower(email) = lower('quispe@limacafe28.com');
END $$;

-- Luego re-ejecutar BLOQUE 2 de 20260602_create_quispe_admin_general.sql (ya con ON CONFLICT)
*/

SELECT '👉 Si Auth está vacío: usa Add user en Dashboard, luego BLOQUE B' AS siguiente_paso;
