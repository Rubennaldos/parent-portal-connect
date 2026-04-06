-- =============================================================================
-- LISTADO: usuarios / cuentas que PARECEN de prueba (todas las sedes)
-- =============================================================================
-- Ejecuta UN BLOQUE a la vez en el SQL Editor de Supabase. Solo lectura.
--
-- Patrones: prueba, test, demo, qa, dummy, fake, temporal, dev, borrar,
--           sandbox, staging y dominios @test., @example., mailinator, etc.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — public.profiles (admins, cajeros, padres con fila en profiles)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  p.id,
  p.email,
  p.role,
  p.full_name,
  p.school_id,
  sch.name AS sede_nombre,
  p.created_at,
  p.saved_email_fiscal,
  p.saved_razon_social
FROM public.profiles p
LEFT JOIN public.schools sch ON sch.id = p.school_id
WHERE
  COALESCE(p.email, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|\bdev\b|borrar|sandbox|staging)'
  OR COALESCE(p.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|\bdev\b|borrar|sandbox)'
  OR COALESCE(p.saved_email_fiscal, '') ~* '(prueba|test|demo|@example\.|@test\.|mailinator)'
  OR COALESCE(p.saved_razon_social, '') ~* '(prueba|test|demo|fake|temporal)'
  OR COALESCE(p.email, '') ~* '@(test\.|example\.|mailinator\.|yopmail\.|guerrillamail\.)'
ORDER BY p.created_at DESC NULLS LAST;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — auth.users (cuenta de login; a veces hay diferencias con profiles)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  u.id,
  u.email,
  u.created_at,
  u.email_confirmed_at,
  u.raw_user_meta_data
FROM auth.users u
WHERE
  COALESCE(u.email, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox|staging)'
  OR COALESCE(u.email, '') ~* '@(test\.|example\.|mailinator\.|yopmail\.|guerrillamail\.)'
  OR COALESCE(u.raw_user_meta_data::text, '') ~* '(prueba|test|demo|fake|dummy)'
ORDER BY u.created_at DESC NULLS LAST;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 — teacher_profiles (profesores / personal)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  tp.id,
  tp.full_name,
  tp.dni,
  tp.corporate_email,
  tp.personal_email,
  tp.school_id_1,
  s1.name AS sede_1,
  tp.school_id_2,
  s2.name AS sede_2,
  tp.created_at
FROM public.teacher_profiles tp
LEFT JOIN public.schools s1 ON s1.id = tp.school_id_1
LEFT JOIN public.schools s2 ON s2.id = tp.school_id_2
WHERE
  COALESCE(tp.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
  OR COALESCE(tp.corporate_email, '') ~* '(prueba|test|demo|@example\.|@test\.|mailinator\.)'
  OR COALESCE(tp.personal_email, '') ~* '(prueba|test|demo|@example\.|@test\.|mailinator\.)'
  OR COALESCE(tp.dni, '') ~* '^(0{6,}|1{6,}|12345678)$'
ORDER BY tp.created_at DESC NULLS LAST;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 — parent_profiles (datos del padre; user_id = auth user)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  pp.user_id,
  pr.email AS email_login,
  pr.role,
  pp.full_name,
  pp.nickname,
  pp.dni,
  pp.phone_1,
  pp.school_id,
  sch.name AS sede_nombre,
  pr.created_at AS perfil_creado_en
FROM public.parent_profiles pp
LEFT JOIN public.profiles pr ON pr.id = pp.user_id
LEFT JOIN public.schools sch ON sch.id = pp.school_id
WHERE
  COALESCE(pp.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
  OR COALESCE(pp.nickname, '') ~* '(prueba|test|demo|qa|dummy|fake)'
  OR COALESCE(pr.email, '') ~* '(prueba|test|demo|@example\.|@test\.|mailinator\.)'
  OR COALESCE(pp.dni, '') ~* '^(0{6,}|1{6,}|12345678)$'
ORDER BY pr.created_at DESC NULLS LAST;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 — students (alumnos usados en pruebas de POS; no son “login”)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  st.id,
  st.full_name,
  st.grade,
  st.section,
  st.school_id,
  sch.name AS sede_nombre,
  st.parent_id,
  pr.email AS padre_email,
  st.is_active
FROM public.students st
LEFT JOIN public.schools sch ON sch.id = st.school_id
LEFT JOIN public.profiles pr ON pr.id = st.parent_id
WHERE
  COALESCE(st.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
ORDER BY st.full_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 6 — Resumen (conteos por fuente)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM public.profiles p WHERE
    COALESCE(p.email, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox|staging)'
    OR COALESCE(p.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
    OR COALESCE(p.email, '') ~* '@(test\.|example\.|mailinator\.|yopmail\.)'
  ) AS profiles_app,
  (SELECT COUNT(*) FROM auth.users u WHERE
    COALESCE(u.email, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
    OR COALESCE(u.email, '') ~* '@(test\.|example\.|mailinator\.|yopmail\.)'
  ) AS auth_users,
  (SELECT COUNT(*) FROM public.teacher_profiles tp WHERE
    COALESCE(tp.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
    OR COALESCE(tp.corporate_email, '') ~* '(prueba|test|demo|@example\.|@test\.)'
    OR COALESCE(tp.personal_email, '') ~* '(prueba|test|demo|@example\.|@test\.)'
  ) AS teacher_profiles,
  (SELECT COUNT(*) FROM public.parent_profiles pp
   LEFT JOIN public.profiles pr ON pr.id = pp.user_id
   WHERE
     COALESCE(pp.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
     OR COALESCE(pp.nickname, '') ~* '(prueba|test|demo|qa|dummy|fake)'
     OR COALESCE(pr.email, '') ~* '(prueba|test|demo|@example\.|@test\.|mailinator\.)'
  ) AS parent_profiles,
  (SELECT COUNT(*) FROM public.students st WHERE
    COALESCE(st.full_name, '') ~* '(prueba|test|demo|qa|dummy|fake|temporal|borrar|sandbox)'
  ) AS students_nombre_prueba;
