-- ============================================================
-- BÚSQUEDA INTELIGENTE v2 — pg_trgm + índices GIN
-- ============================================================
-- Por qué es mejor que ILIKE:
--   ILIKE '%term%'  → escaneo secuencial O(n), sin índice, lento con >5k filas
--   pg_trgm GIN     → índice O(log n), maneja typos, tildes, parciales, muy rápido
-- Corre este script una vez en el Editor SQL de Supabase
-- ============================================================

-- ── Extensiones ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- similitud trigrama
CREATE EXTENSION IF NOT EXISTS unaccent;  -- normalización de tildes

-- ── normalize_search: quitar tildes + minúsculas + espacios ─────────────────
-- Declarada IMMUTABLE (requerido para índices de expresión en PostgreSQL).
-- unaccent() es STABLE por defecto; al llamarla con schema calificado
-- dentro de una función IMMUTABLE, PostgreSQL acepta la expresión de índice.
-- Es seguro porque unaccent solo lee su diccionario interno, nunca varía.

CREATE OR REPLACE FUNCTION normalize_search(t text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent(lower(trim(t))); $$;

-- ── Índices GIN en full_name (usa la función IMMUTABLE) ──────────────────────
-- Estos índices permiten que word_similarity() sea O(log n)

CREATE INDEX IF NOT EXISTS idx_students_name_trgm
  ON students USING gin (normalize_search(full_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_teacher_profiles_name_trgm
  ON teacher_profiles USING gin (normalize_search(full_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm
  ON profiles USING gin (normalize_search(full_name) gin_trgm_ops);

-- ── RPC principal: search_persons_v2 ─────────────────────────────────────────
-- Busca alumnos, profesores y admins en paralelo.
-- word_similarity(query, name) = mide similitud de la query contra
--   cualquier "palabra" del nombre completo, no contra el string entero.
--   Ej: buscar "chavez" → alta similitud contra "Andrea Chávez López"
--       buscar "andree" → alta similitud contra "Andrea" (typo tolerado)
--
-- Parámetros:
--   p_query     → texto que escribe el usuario
--   p_school_id → null = todas las sedes (admin_general)
--   p_types     → array de 'student','teacher','admin'
--   p_limit     → máx resultados por tipo (default 10)

DROP FUNCTION IF EXISTS public.search_persons_v2(text, uuid, text[], int);

CREATE OR REPLACE FUNCTION public.search_persons_v2(
  p_query     text,
  p_school_id uuid    DEFAULT NULL,
  p_types     text[]  DEFAULT ARRAY['student', 'teacher', 'admin'],
  p_limit     int     DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  full_name    text,
  entity_type  text,   -- 'student' | 'teacher' | 'admin'
  subtitle     text,   -- salón, área, rol, etc.
  school_name  text,
  photo_url    text,
  score        float4  -- similitud 0..1 (mayor = mejor match)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := normalize_search(p_query);
BEGIN
  -- Con menos de 2 caracteres no buscamos (evita resultados de baja calidad)
  IF length(v_norm) < 2 THEN
    RETURN;
  END IF;

  -- ── ALUMNOS ─────────────────────────────────────────────────────────────
  IF 'student' = ANY(p_types) THEN
    RETURN QUERY
      SELECT
        s.id,
        s.full_name,
        'student'::text                                          AS entity_type,
        COALESCE(s.grade || ' ' || s.section, s.grade, '')      AS subtitle,
        sc.name                                                  AS school_name,
        s.photo_url                                              AS photo_url,
        word_similarity(v_norm, normalize_search(s.full_name))  AS score
      FROM students s
      LEFT JOIN schools sc ON sc.id = s.school_id
      WHERE
        (p_school_id IS NULL OR s.school_id = p_school_id)
        AND s.is_active = true
        AND normalize_search(s.full_name) % v_norm   -- operador trigrama (usa índice GIN)
      ORDER BY score DESC
      LIMIT p_limit;
  END IF;

  -- ── PROFESORES ──────────────────────────────────────────────────────────
  IF 'teacher' = ANY(p_types) THEN
    RETURN QUERY
      SELECT
        tp.id,
        tp.full_name,
        'teacher'::text                                           AS entity_type,
        COALESCE(tp.area, '')                                     AS subtitle,
        sc.name                                                   AS school_name,
        NULL::text                                                AS photo_url,
        word_similarity(v_norm, normalize_search(tp.full_name))  AS score
      FROM teacher_profiles tp
      LEFT JOIN schools sc ON sc.id = tp.school_1_id
      WHERE
        (p_school_id IS NULL OR tp.school_1_id = p_school_id)
        AND normalize_search(tp.full_name) % v_norm
      ORDER BY score DESC
      LIMIT p_limit;
  END IF;

  -- ── ADMINS / STAFF ──────────────────────────────────────────────────────
  IF 'admin' = ANY(p_types) THEN
    RETURN QUERY
      SELECT
        pr.id,
        COALESCE(pr.full_name, pr.email, '')                      AS full_name,
        'admin'::text                                             AS entity_type,
        COALESCE(pr.role, '')                                     AS subtitle,
        NULL::text                                                AS school_name,
        NULL::text                                                AS photo_url,
        word_similarity(v_norm,
          normalize_search(COALESCE(pr.full_name, pr.email, ''))) AS score
      FROM profiles pr
      WHERE
        (p_school_id IS NULL OR pr.school_id = p_school_id)
        AND normalize_search(COALESCE(pr.full_name, pr.email, '')) % v_norm
      ORDER BY score DESC
      LIMIT p_limit;
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION public.search_persons_v2(text, uuid, text[], int)
  TO authenticated;

-- ── Ajustar umbral de similitud (default 0.3 puede ser muy estricto) ─────────
-- word_similarity_threshold controla cuán parecido debe ser el trigrama.
-- 0.2 = más resultados (tolera más typos), 0.4 = más estricto (solo buenos matches)
-- Este SET es a nivel de sesión; para cambiarlo globalmente:
--   ALTER DATABASE postgres SET pg_trgm.word_similarity_threshold = 0.2;
-- Lo dejamos en 0.2 para una experiencia fluida de búsqueda de nombres.
DO $$
BEGIN
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.2', false);
EXCEPTION WHEN OTHERS THEN NULL; -- ignorar si no está disponible en esta versión
END;
$$;

-- ── Compatibilidad: actualizar buscar_usuarios_admin para usar trgm ──────────
-- (por si algo ya usa la función vieja — la mejoramos in-place)
CREATE OR REPLACE FUNCTION public.buscar_usuarios_admin(
  p_term    TEXT    DEFAULT '',
  p_role    TEXT    DEFAULT 'all',
  p_offset  INT     DEFAULT 0,
  p_limit   INT     DEFAULT 50
)
RETURNS SETOF json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'id',            pr.id,
    'email',         pr.email,
    'full_name',     pr.full_name,
    'role',          pr.role,
    'school_id',     pr.school_id,
    'pos_number',    pr.pos_number,
    'ticket_prefix', pr.ticket_prefix,
    'total',         COUNT(*) OVER()
  )
  FROM profiles pr
  WHERE
    (p_role = 'all' OR pr.role = p_role)
    AND (
      p_term = ''
      OR normalize_search(COALESCE(pr.email, ''))     ILIKE '%' || normalize_search(p_term) || '%'
      OR normalize_search(COALESCE(pr.full_name, '')) % normalize_search(p_term)
      OR pr.id IN (
          SELECT DISTINCT st.parent_id
          FROM students st
          WHERE st.parent_id IS NOT NULL
            AND normalize_search(st.full_name) % normalize_search(p_term)
      )
    )
  ORDER BY
    CASE WHEN p_term = '' THEN 0
         ELSE -word_similarity(normalize_search(p_term),
                               normalize_search(COALESCE(pr.full_name, '')))::int
    END,
    pr.email
  LIMIT  p_limit
  OFFSET p_offset
$$;

GRANT EXECUTE ON FUNCTION public.buscar_usuarios_admin(TEXT, TEXT, INT, INT)
  TO authenticated;
