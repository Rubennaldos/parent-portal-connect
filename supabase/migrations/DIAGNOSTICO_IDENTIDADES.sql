-- ============================================================
-- PASO A: Verificar que el usuario existe en auth.users
-- (Debe aparecer una fila con el email de Matías)
-- ============================================================
SELECT id, email, created_at
FROM auth.users
WHERE email = 'matiaslogistica@limacafe28.com';

-- ============================================================
-- PASO B: Ver si ya tiene identidad (debe devolver 0 filas)
-- ============================================================
SELECT i.id, i.user_id, i.provider
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE u.email = 'matiaslogistica@limacafe28.com';
