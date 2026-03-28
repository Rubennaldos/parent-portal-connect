-- Ejecutar PRIMERO (solo rellena auth.identities faltantes).
-- Si ya corrió bien, no pasa nada: el WHERE evita duplicados.

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
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities i WHERE i.user_id = u.id
)
  AND u.aud = 'authenticated';

-- Debe devolver 0 filas si ya todos tienen identidad:
SELECT u.email, u.id
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
  AND u.aud = 'authenticated';
