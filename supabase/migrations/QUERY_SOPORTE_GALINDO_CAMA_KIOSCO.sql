-- =============================================================================
-- SOPORTE: Karen Galindo / Ariana Cama — ¿Menú solo vs consumos en kiosco?
-- =============================================================================
-- Ejecuta UN BLOQUE a la vez en el SQL Editor de Supabase (solo lectura).
--
-- VERDAD TÉCNICA (código del portal):
--   - NO existe columna `metadata` en `public.students`. El JSON está en
--     `transactions.metadata` (p. ej. lunch_order_id para almuerzos).
--   - El bloqueo de kiosco por alumno es `students.kiosk_disabled` (boolean).
--   - Si en tu BD está aplicada la migración `20260313_add_kiosk_preference_to_profiles`,
--     la intención del padre puede estar en `profiles.kiosk_preference`.
--     Si esa columna NO existe, usa solo `students.kiosk_disabled` y el bloque 0.
--   - No hay tabla `subscriptions` en este proyecto; usa perfiles + students.
--
-- Ajusta los ILIKE si el nombre en BD tiene tilde o orden distinto.
-- =============================================================================


-- ── BLOQUE 0: Columnas que realmente tiene `profiles` en TU base ────────────
-- Corre esto primero si un bloque falla por “column does not exist”.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
ORDER BY ordinal_position;


-- ── BLOQUE 1: Localizar madre (padre en ficha) — sin columnas opcionales ──────
SELECT
  pp.user_id     AS parent_uuid,
  pp.full_name   AS nombre_en_ficha,
  pp.phone_1     AS telefono,
  pr.email       AS email_login,
  pr.role,
  pr.created_at  AS perfil_app_creado
FROM parent_profiles pp
LEFT JOIN profiles pr ON pr.id = pp.user_id
WHERE pp.full_name ILIKE '%Galindo%'
   OR pr.full_name ILIKE '%Galindo%'
   OR pr.email ILIKE '%galindo%'
ORDER BY pp.full_name;


-- ── BLOQUE 1bis: Perfil del padre — onboarding (columna que SÍ tienes en BD)
-- `free_account_onboarding_completed` solo indica si terminó el tutorial inicial;
-- NO es lo mismo que “solo menú” (eso, si existe, sería `kiosk_preference`).
-- Sustituye [PARENT_UUID] o usa el bloque “Karen” más abajo.
SELECT
  pr.id,
  pr.email,
  pr.free_account_onboarding_completed
FROM profiles pr
WHERE pr.id = '[PARENT_UUID]'::uuid;


-- ── BLOQUE 1ter (OPCIONAL): `kiosk_preference` — solo si el BLOQUE 0 la listó.
-- Si da error 42703, no existe en tu BD; ignora este bloque.
/*
SELECT pr.id, pr.email, pr.kiosk_preference
FROM profiles pr
WHERE pr.id = '[PARENT_UUID]'::uuid;
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- CASO KAREN GALINDO — UUID ya ubicado (bloque 1)
-- parent_id = 56bb1c08-28ea-44de-b41e-bef67be266cf  |  lutrella.123@gmail.com
-- ═══════════════════════════════════════════════════════════════════════════

-- Karen — 1bis con UUID fijo
SELECT
  pr.id,
  pr.email,
  pr.free_account_onboarding_completed
FROM profiles pr
WHERE pr.id = '56bb1c08-28ea-44de-b41e-bef67be266cf'::uuid;


-- Karen — BLOQUE 2: hijas/os
SELECT
  s.id              AS student_id,
  s.full_name,
  s.created_at      AS cuenta_alumno_creada,
  s.kiosk_disabled  AS kiosco_BLOQUEADO_true,
  s.free_account,
  s.balance,
  s.is_active,
  sch.name          AS sede
FROM students s
LEFT JOIN schools sch ON sch.id = s.school_id
WHERE s.parent_id = '56bb1c08-28ea-44de-b41e-bef67be266cf'::uuid
ORDER BY s.created_at;


-- Karen — BLOQUE 3: auth.users
SELECT
  id,
  email,
  created_at,
  email_confirmed_at,
  raw_user_meta_data
FROM auth.users
WHERE id = '56bb1c08-28ea-44de-b41e-bef67be266cf'::uuid;


-- ═══════════════════════════════════════════════════════════════════════════
-- Karen + Ariana — bloques 4–6 LISTOS (sin pegar student_id)
-- parent fijo + alumna por nombre (ajusta ILIKE si el nombre en BD es distinto)
-- ═══════════════════════════════════════════════════════════════════════════

-- Karen — confirma alumna “Ariana Cama” (debe salir 1 fila; si salen 0 o varias, ajusta ILIKE)
SELECT
  s.id              AS student_id,
  s.full_name,
  s.created_at,
  s.kiosk_disabled,
  s.balance
FROM students s
WHERE s.parent_id = '56bb1c08-28ea-44de-b41e-bef67be266cf'::uuid
  AND s.full_name ILIKE '%Cama%'
  AND (s.full_name ILIKE '%Ariana%' OR s.full_name ILIKE '%Arianna%')
ORDER BY s.created_at;


-- Karen + Ariana — BLOQUE 4: detalle consumos SOLO KIOSCO
WITH alumna AS (
  SELECT s.id
  FROM students s
  WHERE s.parent_id = '56bb1c08-28ea-44de-b41e-bef67be266cf'::uuid
    AND s.full_name ILIKE '%Cama%'
    AND (s.full_name ILIKE '%Ariana%' OR s.full_name ILIKE '%Arianna%')
  ORDER BY s.created_at
  LIMIT 1
)
SELECT
  t.id,
  t.created_at,
  (timezone('America/Lima', t.created_at))::date AS fecha_lima,
  ABS(t.amount)::numeric(12, 2) AS soles,
  t.payment_status,
  t.ticket_code,
  t.description,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
WHERE t.student_id = (SELECT id FROM alumna)
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND COALESCE(t.payment_status, '') <> 'cancelled'
  AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '')
ORDER BY t.created_at;


-- Karen + Ariana — BLOQUE 5: total kiosco
WITH alumna AS (
  SELECT s.id
  FROM students s
  WHERE s.parent_id = '56bb1c08-28ea-44de-b41e-bef67be266cf'::uuid
    AND s.full_name ILIKE '%Cama%'
    AND (s.full_name ILIKE '%Ariana%' OR s.full_name ILIKE '%Arianna%')
  ORDER BY s.created_at
  LIMIT 1
)
SELECT
  COUNT(*) AS num_tickets,
  COALESCE(SUM(ABS(t.amount)), 0)::numeric(12, 2) AS total_soles_kiosco
FROM transactions t
WHERE t.student_id = (SELECT id FROM alumna)
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND COALESCE(t.payment_status, '') <> 'cancelled'
  AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '');


-- Karen + Ariana — BLOQUE 6: transacciones de almuerzo (comparar con kiosco)
WITH alumna AS (
  SELECT s.id
  FROM students s
  WHERE s.parent_id = '56bb1c08-28ea-44de-b41e-bef67be266cf'::uuid
    AND s.full_name ILIKE '%Cama%'
    AND (s.full_name ILIKE '%Ariana%' OR s.full_name ILIKE '%Arianna%')
  ORDER BY s.created_at
  LIMIT 1
)
SELECT
  t.id,
  t.created_at,
  ABS(t.amount)::numeric(12, 2) AS soles,
  t.payment_status,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
WHERE t.student_id = (SELECT id FROM alumna)
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND (t.metadata->>'lunch_order_id' IS NOT NULL AND t.metadata->>'lunch_order_id' <> '')
ORDER BY t.created_at;


-- ═══════════════════════════════════════════════════════════════════════════
-- Plantillas genéricas (otro padre / otro alumno): usar [PARENT_UUID] / [STUDENT_UUID]
-- ═══════════════════════════════════════════════════════════════════════════


-- ── BLOQUE 2: Hijas/os vinculados (reemplaza [PARENT_UUID] del bloque 1) ───
SELECT
  s.id              AS student_id,
  s.full_name,
  s.created_at      AS cuenta_alumno_creada,
  s.kiosk_disabled  AS kiosco_BLOQUEADO_true,
  s.free_account,
  s.balance,
  s.is_active,
  sch.name          AS sede
FROM students s
LEFT JOIN schools sch ON sch.id = s.school_id
WHERE s.parent_id = '[PARENT_UUID]'::uuid
ORDER BY s.created_at;


-- ── BLOQUE 2b: Si no tienes UUID aún — buscar alumna por nombre ─────────────
SELECT
  s.id,
  s.full_name,
  s.created_at,
  s.kiosk_disabled,
  s.parent_id,
  pr.email AS email_padre,
  pp.full_name AS nombre_padre_ficha
FROM students s
LEFT JOIN profiles pr ON pr.id = s.parent_id
LEFT JOIN parent_profiles pp ON pp.user_id = s.parent_id
WHERE s.full_name ILIKE '%Cama%'
  AND (s.full_name ILIKE '%Ariana%' OR s.full_name ILIKE '%Arianna%')
ORDER BY s.full_name;


-- ── BLOQUE 3: Cuenta de login (auth) — cuándo existió el usuario ────────────
-- Sustituye [PARENT_UUID].
SELECT
  id,
  email,
  created_at,
  email_confirmed_at,
  raw_user_meta_data
FROM auth.users
WHERE id = '[PARENT_UUID]'::uuid;


-- ── BLOQUE 4: Consumos SOLO KIOSCO (excluye almuerzos vía lunch_order_id)
--     Suma esperada ~ S/ 111 si el reclamo es solo POS.
--     Kiosco: type = 'purchase', sin lunch_order_id en metadata.
-- Sustituye [STUDENT_UUID].
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  t.id,
  t.created_at,
  (timezone('America/Lima', t.created_at))::date AS fecha_lima,
  ABS(t.amount)::numeric(12, 2) AS soles,
  t.payment_status,
  t.ticket_code,
  t.description,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
WHERE t.student_id = '[STUDENT_UUID]'::uuid
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND COALESCE(t.payment_status, '') <> 'cancelled'
  AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '')
ORDER BY t.created_at;


-- ── BLOQUE 5: Total kiosco (mismo criterio que bloque 4) ─────────────────────
SELECT
  COUNT(*) AS num_tickets,
  SUM(ABS(t.amount))::numeric(12, 2) AS total_soles_kiosco
FROM transactions t
WHERE t.student_id = '[STUDENT_UUID]'::uuid
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND COALESCE(t.payment_status, '') <> 'cancelled'
  AND (t.metadata->>'lunch_order_id' IS NULL OR t.metadata->>'lunch_order_id' = '');


-- ── BLOQUE 6: Comparar — almuerzos (mismo alumno) por si hay duda de mezcla ─
SELECT
  t.id,
  t.created_at,
  ABS(t.amount)::numeric(12, 2) AS soles,
  t.payment_status,
  t.metadata->>'lunch_order_id' AS lunch_order_id
FROM transactions t
WHERE t.student_id = '[STUDENT_UUID]'::uuid
  AND t.type = 'purchase'
  AND COALESCE(t.is_deleted, false) = false
  AND (t.metadata->>'lunch_order_id' IS NOT NULL AND t.metadata->>'lunch_order_id' <> '')
ORDER BY t.created_at;


-- ── BLOQUE 7: Columnas reales de `students` (por si otra sede tiene migración distinta)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'students'
ORDER BY ordinal_position;
