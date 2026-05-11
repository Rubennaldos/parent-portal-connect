-- ============================================================
-- BÚSQUEDA INTELIGENTE DE PADRES — pg_trgm + RPC server-side
-- ============================================================
-- Patrón alineado con:
--   - 20260409_search_persons_v2.sql  (normalize_search + GIN trigram)
--   - 20260503_sales_report_06_fuzzy_search.sql (índices de expresión)
--
-- Objetivos:
--   1. Búsqueda multicampo (full_name, nickname, dni, email, nombre de alumno)
--   2. Case-insensitive y accent-insensitive (Núñez = nunez)
--   3. Paginación server-side (limit/offset) — REGLA #11.A
--   4. Cero cálculos en el cliente (children_count agregado en SQL)
--   5. school_id seguro (REGLA #5)
--
-- REUSO: normalize_search() ya existe (IMMUTABLE) — NO se redefine.
-- REUSO: idx_students_name_trgm ya existe — NO se duplica.
-- ============================================================

-- ── 0. Extensiones requeridas (idempotente) ───────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── 1. Índices GIN trigramados sobre parent_profiles ──────────────────────
-- Creación defensiva: solo si la columna existe (evita romper migración
-- si el esquema real difiere). Patrón seguro y reversible.
--
-- NOTA: usamos CREATE INDEX (no CONCURRENTLY) porque Supabase ejecuta
-- migraciones en transacción. parent_profiles es tabla pequeña (<10k filas
-- típico), el lock es breve. Si en el futuro crece, recrear con
-- CONCURRENTLY fuera de migración estándar.

DO $$
BEGIN
  -- full_name (siempre presente)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'parent_profiles'
      AND column_name = 'full_name'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_parent_profiles_full_name_trgm
             ON public.parent_profiles
             USING gin (public.normalize_search(full_name) gin_trgm_ops)';
  END IF;

  -- nickname (parcial: solo filas con nickname no nulo)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'parent_profiles'
      AND column_name = 'nickname'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_parent_profiles_nickname_trgm
             ON public.parent_profiles
             USING gin (public.normalize_search(nickname) gin_trgm_ops)
             WHERE nickname IS NOT NULL';
  END IF;

  -- email (parcial)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'parent_profiles'
      AND column_name = 'email'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_parent_profiles_email_trgm
             ON public.parent_profiles
             USING gin (public.normalize_search(email) gin_trgm_ops)
             WHERE email IS NOT NULL';
  END IF;

  -- dni: trigram permite substring ILIKE %dni% con índice
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'parent_profiles'
      AND column_name = 'dni'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_parent_profiles_dni_trgm
             ON public.parent_profiles
             USING gin (dni gin_trgm_ops)
             WHERE dni IS NOT NULL';
  END IF;
END $$;

-- ── 2. RPC: search_parents_v2 ─────────────────────────────────────────────
-- Búsqueda multicampo con paginación server-side y agregados de hijos en SQL.
--
-- Campos buscables:
--   * parent_profiles.full_name   (índice GIN)
--   * parent_profiles.nickname    (índice GIN parcial)
--   * parent_profiles.email       (índice GIN parcial)
--   * parent_profiles.dni         (índice GIN substring)
--   * students.full_name vinculado (idx_students_name_trgm existente)
--
-- Reglas:
--   - Mínimo 3 caracteres en query, sino devuelve listado paginado normal.
--   - p_school_id NULL = admin global (todas las sedes).
--   - Ordena por relevancia (word_similarity) cuando hay query;
--     por full_name cuando no hay query.
--   - Devuelve total_count en cada fila (COUNT(*) OVER()) para paginación
--     en una sola llamada (evita N+1).
--   - children se devuelve como jsonb agregado en SQL (REGLA #11.A).

DROP FUNCTION IF EXISTS public.search_parents_v2(text, uuid, int, int);

CREATE OR REPLACE FUNCTION public.search_parents_v2(
  p_query     text   DEFAULT NULL,
  p_school_id uuid   DEFAULT NULL,
  p_limit     int    DEFAULT 30,
  p_offset    int    DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  user_id         uuid,
  full_name       text,
  nickname        text,
  dni             text,
  phone_1         text,
  phone_2         text,
  email           text,
  address         text,
  school_id       uuid,
  school_name     text,
  children_count  int,
  children        jsonb,
  created_at      timestamptz,
  score           float4,
  total_count     bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm       text;
  v_raw        text;
  v_min_chars  CONSTANT int := 3;
  v_safe_limit int;
  v_safe_offset int;
BEGIN
  -- Sanitizar paginación
  v_safe_limit  := GREATEST(LEAST(COALESCE(p_limit,  30), 200), 1);
  v_safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- Normalizar query: si tiene <3 chars, lo tratamos como "sin filtro"
  -- (devuelve listado paginado completo de la sede correspondiente).
  v_raw  := COALESCE(trim(p_query), '');
  v_norm := CASE
    WHEN length(v_raw) < v_min_chars THEN NULL
    ELSE public.normalize_search(v_raw)
  END;

  RETURN QUERY
  WITH base AS (
    SELECT
      pp.id,
      pp.user_id,
      pp.full_name::text  AS full_name,
      pp.nickname::text   AS nickname,
      pp.dni::text        AS dni,
      pp.phone_1::text    AS phone_1,
      pp.phone_2::text    AS phone_2,
      pp.email::text      AS email,
      pp.address::text    AS address,
      pp.school_id,
      sc.name::text       AS school_name,
      pp.created_at,
      -- Score: 0 sin query; sino max similitud entre todos los campos.
      CASE
        WHEN v_norm IS NULL THEN 0::float4
        ELSE GREATEST(
          word_similarity(v_norm, public.normalize_search(COALESCE(pp.full_name, '')))::real,
          CASE
            WHEN pp.nickname IS NOT NULL
            THEN word_similarity(v_norm, public.normalize_search(pp.nickname))::real
            ELSE 0::real
          END,
          CASE
            WHEN pp.email IS NOT NULL
            THEN word_similarity(v_norm, public.normalize_search(pp.email))::real
            ELSE 0::real
          END,
          CASE
            WHEN pp.dni IS NOT NULL AND pp.dni ILIKE '%' || v_raw || '%'
            THEN 1.0::real
            ELSE 0::real
          END,
          COALESCE((
            SELECT MAX(word_similarity(v_norm, public.normalize_search(s.full_name)))::real
            FROM public.students s
            WHERE s.parent_id = pp.user_id
              AND public.normalize_search(s.full_name) % v_norm
          ), 0::real)
        )::float4
      END AS score
    FROM public.parent_profiles pp
    LEFT JOIN public.schools sc ON sc.id = pp.school_id
    WHERE
      (p_school_id IS NULL OR pp.school_id = p_school_id)
      AND (
        v_norm IS NULL
        OR public.normalize_search(pp.full_name) % v_norm
        OR (pp.nickname IS NOT NULL AND public.normalize_search(pp.nickname) % v_norm)
        OR (pp.email    IS NOT NULL AND public.normalize_search(pp.email)    % v_norm)
        OR (pp.dni      IS NOT NULL AND pp.dni ILIKE '%' || v_raw || '%')
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.parent_id = pp.user_id
            AND public.normalize_search(s.full_name) % v_norm
        )
      )
  ),
  counted AS (
    SELECT b.*, COUNT(*) OVER() AS total_count
    FROM base b
  ),
  paged AS (
    SELECT c.*
    FROM counted c
    ORDER BY
      -- Sin query: alfabético. Con query: por relevancia, luego alfabético.
      CASE WHEN v_norm IS NULL THEN c.full_name END ASC NULLS LAST,
      c.score DESC,
      c.full_name ASC
    LIMIT  v_safe_limit
    OFFSET v_safe_offset
  )
  SELECT
    p.id,
    p.user_id,
    p.full_name,
    p.nickname,
    p.dni,
    p.phone_1,
    p.phone_2,
    p.email,
    p.address,
    p.school_id,
    p.school_name,
    COALESCE(ca.children_count, 0)        AS children_count,
    COALESCE(ca.children, '[]'::jsonb)    AS children,
    p.created_at,
    p.score,
    p.total_count
  FROM paged p
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS children_count,
      jsonb_agg(
        jsonb_build_object(
          'id',        s.id,
          'full_name', s.full_name,
          'grade',     s.grade,
          'section',   s.section
        )
        ORDER BY s.full_name
      ) AS children
    FROM public.students s
    WHERE s.parent_id = p.user_id
  ) ca ON true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_parents_v2(text, uuid, int, int)
  TO authenticated;

COMMENT ON FUNCTION public.search_parents_v2 IS
  'Búsqueda fuzzy multicampo de padres con paginación server-side. '
  'Reusa normalize_search() (unaccent+lower+trim) e índices GIN trigramados. '
  'Campos: full_name, nickname, dni, email + nombre de alumno asociado. '
  'Devuelve children_count y children (jsonb) agregados en SQL (REGLA #11.A). '
  'Min 3 chars en p_query (sino devuelve listado paginado sin filtro). '
  'p_school_id NULL = todas las sedes (uso de admin global, REGLA #5).';

-- ── 3. Smoke test (manual, comentado) ─────────────────────────────────────
-- Para verificar tras aplicar la migración:
--
--   -- Listado paginado sin búsqueda (debe devolver 30 ordenados por nombre)
--   SELECT id, full_name, dni, children_count, total_count
--   FROM public.search_parents_v2(NULL, NULL, 30, 0);
--
--   -- Búsqueda con acentos (Núñez = nunez)
--   SELECT full_name, score, total_count
--   FROM public.search_parents_v2('nunez', NULL, 30, 0);
--
--   -- Búsqueda por DNI parcial
--   SELECT full_name, dni, score
--   FROM public.search_parents_v2('12345', NULL, 30, 0);
--
--   -- Búsqueda por nombre de alumno (encuentra al padre)
--   SELECT full_name, children, score
--   FROM public.search_parents_v2('mateo', NULL, 30, 0);
