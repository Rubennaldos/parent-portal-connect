-- =============================================================================
-- DIAGNÓSTICO + FIX DEFINITIVO CONTRASEÑA: quispe@limacafe28.com
--
-- ⚠️ El UPDATE con crypt() en SQL NO garantiza login en el portal.
--    GoTrue valida el hash con su propio motor (Admin API / Dashboard).
--    Aunque password_coincide_en_postgres = true, el login puede seguir en 400.
--
-- SOLUCIÓN QUE SÍ FUNCIONA (elige una):
--   A) Dashboard: Authentication → Users → quispe → Reset password → quispe123
--   B) Panel admin (logueado como superadmin): Perfiles → Resetear contraseña
--   C) curl Admin API (abajo, con service_role de Settings → API)
-- =============================================================================

-- ── 1) Diagnóstico: comparar hash de Quispe vs un usuario que SÍ entra ──
SELECT 'hash compare' AS paso,
       u.email,
       left(u.encrypted_password, 20) AS hash_inicio,
       CASE
         WHEN u.encrypted_password LIKE '$argon2%' THEN 'argon2 (SQL crypt NO sirve para login)'
         WHEN u.encrypted_password LIKE '$2a$%' OR u.encrypted_password LIKE '$2b$%' THEN 'bcrypt'
         ELSE 'formato_desconocido'
       END AS tipo_hash,
       u.email_confirmed_at IS NOT NULL AS email_confirmado,
       u.deleted_at IS NULL AS no_borrado,
       (u.encrypted_password = crypt('quispe123'::text, u.encrypted_password)) AS ok_en_postgres_solo
FROM auth.users u
WHERE lower(u.email) IN (
  lower('quispe@limacafe28.com'),
  lower('superadmin@limacafe28.com')
)
ORDER BY u.email;

SELECT 'identities' AS paso, i.provider, i.provider_id, i.user_id
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE lower(u.email) = lower('quispe@limacafe28.com');

-- Obtener user_id para el curl (copiar id):
SELECT id AS user_id_para_curl, email
FROM auth.users
WHERE lower(email) = lower('quispe@limacafe28.com');

-- =============================================================================
-- C) RESET VÍA ADMIN API (reemplaza YOUR_SERVICE_ROLE y USER_ID)
-- Ejecutar en PowerShell / terminal (NO en SQL Editor):
--
-- $headers = @{
--   "apikey" = "YOUR_SERVICE_ROLE"
--   "Authorization" = "Bearer YOUR_SERVICE_ROLE"
--   "Content-Type" = "application/json"
-- }
-- $body = '{"password":"quispe123","email_confirm":true}' | ConvertTo-Json
-- Invoke-RestMethod -Method Put `
--   -Uri "https://duxqzozoahvrvqseinji.supabase.co/auth/v1/admin/users/USER_ID" `
--   -Headers $headers `
--   -Body '{"password":"quispe123","email_confirm":true}'
-- =============================================================================
