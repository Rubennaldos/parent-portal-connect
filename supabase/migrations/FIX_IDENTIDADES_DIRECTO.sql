-- ============================================================
-- FIX FINAL: Agregar la identidad que falta a TODOS los admins
-- que fueron creados sin auth.identities (incluyendo Matías).
-- 
-- SIN funciones, SIN $$. Solo un INSERT directo.
-- Ejecutar completo, de una sola vez.
-- ============================================================

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
  u.created_at,
  u.created_at,
  u.created_at
FROM auth.users u
WHERE u.aud = 'authenticated'
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id
  );

-- ── Verificación: debe devolver 0 filas ─────────────────────
SELECT u.email
FROM auth.users u
WHERE u.aud = 'authenticated'
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id
  );
