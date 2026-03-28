-- =============================================================================
-- FIX: instance_id en auth.users
--
-- El RPC create_admin_user usaba instance_id = '00000000-...'. En Supabase
-- alojado, cada usuario debe tener el instance_id REAL del proyecto (el mismo
-- que tienen los usuarios creados por Auth / Admin API). Si no, el login puede
-- fallar con: "Database error querying schema".
--
-- PASO 1 — Ver Matías vs un usuario que SÍ pueda entrar (padre u operador):
-- =============================================================================
SELECT email, instance_id
FROM auth.users
WHERE email IN ('matiaslogistica@limacafe28.com')
   OR instance_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY email;

-- PASO 2 — Corregir TODOS los usuarios con instance_id en ceros
-- (copia el instance_id de cualquier usuario válido del mismo proyecto)
-- =============================================================================
UPDATE auth.users AS u
SET instance_id = ref.instance_id
FROM (
  SELECT instance_id
  FROM auth.users
  WHERE instance_id IS NOT NULL
    AND instance_id <> '00000000-0000-0000-0000-000000000000'::uuid
  LIMIT 1
) AS ref
WHERE u.instance_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- PASO 3 — Verificar: no debe quedar ninguno con ceros (o solo si no había ref.)
-- =============================================================================
SELECT id, email, instance_id
FROM auth.users
WHERE instance_id = '00000000-0000-0000-0000-000000000000'::uuid;
