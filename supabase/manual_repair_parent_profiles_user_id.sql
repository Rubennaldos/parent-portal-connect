-- ============================================================
-- REPARACIÓN MANUAL — parent_profiles.user_id nulo
-- ============================================================
-- Propósito: vincular registros de parent_profiles que tienen
-- email válido pero user_id NULL con su usuario en auth.users.
--
-- ANTES de ejecutar el UPDATE:
--   1. Ejecuta el bloque DIAGNÓSTICO (PASO 1) y revisa los resultados.
--   2. Confirma que los matches son correctos (1 a 1, sin ambiguedad).
--   3. Solo entonces ejecuta el PASO 2 (UPDATE controlado).
--
-- Este script NO borra nada, NO crea registros, NO toca políticas.
-- Solo escribe en parent_profiles.user_id de filas que cumplan
-- TODAS las condiciones de seguridad.
-- ============================================================


-- ============================================================
-- PASO 1 — DIAGNÓSTICO (solo lectura, sin riesgo)
-- Muestra qué filas serían actualizadas y con qué auth_user_id.
-- ============================================================
SELECT
  pp.id                          AS parent_profile_id,
  pp.email                       AS pp_email,
  au.id                          AS auth_user_id_a_vincular,
  au.email                       AS auth_email,
  -- Cuántos auth.users comparten ese mismo email (>1 = ambiguo, no tocar)
  (
    SELECT COUNT(*) FROM auth.users au2
    WHERE lower(trim(au2.email)) = lower(trim(pp.email))
  )                              AS coincidencias_auth,
  -- ¿Ya existe otro parent_profile con ese auth_user_id? (>0 = colisión, no tocar)
  (
    SELECT COUNT(*) FROM public.parent_profiles pp2
    WHERE pp2.user_id = au.id
      AND pp2.id <> pp.id
  )                              AS colisiones_en_parent_profiles
FROM public.parent_profiles pp
JOIN auth.users au
  ON lower(trim(au.email)) = lower(trim(pp.email))
WHERE pp.user_id IS NULL
  AND pp.email IS NOT NULL
  AND trim(pp.email) <> ''
ORDER BY pp.email;

-- ============================================================
-- PASO 2 — UPDATE CONTROLADO
-- Solo ejecutar si el PASO 1 no muestra ninguna fila con
--   coincidencias_auth > 1  o  colisiones_en_parent_profiles > 0.
-- ============================================================
/*  ← Descomenta este bloque solo cuando hayas validado el PASO 1.

UPDATE public.parent_profiles pp
SET    user_id = au.id
FROM   auth.users au
WHERE  pp.user_id IS NULL
  AND  pp.email   IS NOT NULL
  AND  trim(pp.email) <> ''
  AND  lower(trim(au.email)) = lower(trim(pp.email))
  -- Guardia 1: el email solo existe en UN usuario de auth (sin ambigüedad).
  AND  (
    SELECT COUNT(*) FROM auth.users au2
    WHERE lower(trim(au2.email)) = lower(trim(pp.email))
  ) = 1
  -- Guardia 2: ese auth_user_id no está ya asignado a otro parent_profile.
  AND  NOT EXISTS (
    SELECT 1 FROM public.parent_profiles pp2
    WHERE  pp2.user_id = au.id
      AND  pp2.id <> pp.id
  );

-- Verificar cuántas filas se actualizaron:
SELECT COUNT(*) AS actualizados
FROM   public.parent_profiles
WHERE  user_id IS NOT NULL;

-- Ver si quedan huérfanos después:
SELECT COUNT(*) AS siguen_sin_user_id
FROM   public.parent_profiles
WHERE  user_id IS NULL;

*/
