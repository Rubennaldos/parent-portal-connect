-- =============================================================================
-- 20260527_parent_crm_behavior_soft_delete.sql
-- Mini-CRM en parent_profiles + search_parents_v3 v6
--
-- Cambios:
--   1. Enum parent_behavior_profile (amable | neutro | dificil)
--   2. Columnas CRM + soft-delete en parent_profiles
--   3. Índices de soporte para listados admin
--   4. search_parents_v3 v6:
--      a. Filtra is_deleted = false (no devuelve borrados)
--      b. Devuelve campos CRM (behavior_profile, is_suspended, etc.)
--      c. behavior_notes SOLO visible para admins (check_is_admin())
--      d. CORRECCIÓN CRÍTICA: kiosk_disabled incluido en children JSONB
--         (su ausencia rompía la UX de Consumo Libre vs Solo Almuerzos)
--
-- Esta migración es idempotente (IF NOT EXISTS / DROP IF EXISTS).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tipo ENUM para perfil de comportamiento CRM
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_type     t
    JOIN   pg_namespace n ON n.oid = t.typnamespace
    WHERE  n.nspname = 'public'
      AND  t.typname = 'parent_behavior_profile'
  ) THEN
    CREATE TYPE public.parent_behavior_profile AS ENUM (
      'amable',
      'neutro',
      'dificil'
    );
  END IF;
END $$;

COMMENT ON TYPE public.parent_behavior_profile IS
  'Perfil de trato interno del padre (mini-CRM): amable | neutro | dificil. Solo visible para staff administrativo.';

-- ---------------------------------------------------------------------------
-- 2) Columnas CRM + Soft-delete en parent_profiles  (idempotente)
-- ---------------------------------------------------------------------------
ALTER TABLE public.parent_profiles
  ADD COLUMN IF NOT EXISTS behavior_profile public.parent_behavior_profile
    NOT NULL DEFAULT 'neutro',
  ADD COLUMN IF NOT EXISTS behavior_notes   text,
  ADD COLUMN IF NOT EXISTS is_suspended     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_deleted       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by       uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.parent_profiles.behavior_profile IS
  'Semáforo CRM de trato: amable | neutro | dificil. Solo staff administrador.';
COMMENT ON COLUMN public.parent_profiles.behavior_notes IS
  'Notas internas confidenciales de trato. Solo admins (SECURITY DEFINER lo oculta en el RPC).';
COMMENT ON COLUMN public.parent_profiles.is_suspended IS
  'Cuenta suspendida por negocio. No borra historial ni saldo. Reversible.';
COMMENT ON COLUMN public.parent_profiles.is_deleted IS
  'Soft delete lógico: el registro permanece intacto para auditoría contable.';
COMMENT ON COLUMN public.parent_profiles.deleted_at IS
  'Marca de tiempo Lima (timezone America/Lima) del soft delete.';
COMMENT ON COLUMN public.parent_profiles.deleted_by IS
  'UUID del admin (profiles.id) que ejecutó el soft delete. Trazabilidad obligatoria.';

-- ---------------------------------------------------------------------------
-- 3) Constraint de consistencia para soft delete
--    Si NO está borrado → los campos de borrado deben ser nulos.
--    Si SÍ está borrado → se permite cualquier combinación (RPC pondrá los valores).
-- ---------------------------------------------------------------------------
ALTER TABLE public.parent_profiles
  DROP CONSTRAINT IF EXISTS parent_profiles_soft_delete_consistency;

ALTER TABLE public.parent_profiles
  ADD CONSTRAINT parent_profiles_soft_delete_consistency CHECK (
    (is_deleted = false AND deleted_at IS NULL AND deleted_by IS NULL)
    OR (is_deleted = true)
  );

-- ---------------------------------------------------------------------------
-- 4) Índices de soporte
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_parent_profiles_crm_active
  ON public.parent_profiles (school_id, behavior_profile)
  WHERE COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_parent_profiles_suspended
  ON public.parent_profiles (is_suspended)
  WHERE COALESCE(is_suspended, false) = true
    AND COALESCE(is_deleted, false)   = false;

-- ---------------------------------------------------------------------------
-- 5) search_parents_v3 v6
--    DROP obligatorio porque cambia el tipo devuelto (RETURNS TABLE).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_parents_v3(text, uuid, int, int);

CREATE OR REPLACE FUNCTION public.search_parents_v3(
  p_query     text DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_limit     int  DEFAULT 50,
  p_offset    int  DEFAULT 0
)
RETURNS TABLE (
  -- Campos de identidad
  id                          uuid,
  user_id                     uuid,
  full_name                   text,
  nickname                    text,
  dni                         text,
  -- Contacto responsable 1
  phone_1                     text,
  phone_2                     text,
  email                       text,
  address                     text,
  -- Responsable 2
  responsible_2_full_name     text,
  responsible_2_dni           text,
  responsible_2_document_type text,
  responsible_2_phone_1       text,
  responsible_2_email         text,
  responsible_2_address       text,
  -- Sede
  school_id                   uuid,
  school_name                 text,
  -- Hijos
  children                    jsonb,
  -- Meta
  created_at                  timestamptz,
  -- Mini-CRM (v6)
  behavior_profile            public.parent_behavior_profile,
  behavior_notes              text,      -- NULL para no-admins
  is_suspended                boolean,
  is_deleted                  boolean,
  deleted_at                  timestamptz,
  -- Búsqueda
  score                       float4,
  total_count                 bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit      int     := GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1);
  v_offset     int     := GREATEST(COALESCE(p_offset, 0), 0);
  v_raw_query  text    := COALESCE(trim(p_query), '');
  v_norm_query text    := NULL;
  v_is_admin   boolean := COALESCE(public.check_is_admin(), false);
BEGIN
  IF v_raw_query <> '' THEN
    v_norm_query := public.normalize_search(v_raw_query);
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      pp.id,
      pp.user_id,
      COALESCE(NULLIF(pp.full_name, ''), pr.full_name)::text               AS full_name,
      pp.nickname::text,
      pp.dni::text,
      pp.phone_1::text,
      pp.phone_2::text,
      COALESCE(NULLIF(pp.email, ''), pr.email)::text                       AS email,
      pp.address::text,
      pp.responsible_2_full_name::text,
      pp.responsible_2_dni::text,
      pp.responsible_2_document_type::text,
      pp.responsible_2_phone_1::text,
      pp.responsible_2_email::text,
      pp.responsible_2_address::text,
      pp.school_id,
      sc.name::text                                                        AS school_name,
      pp.created_at::timestamptz,
      pp.behavior_profile,
      -- behavior_notes solo para admins (confidencial)
      CASE
        WHEN v_is_admin THEN pp.behavior_notes
        ELSE NULL
      END::text                                                            AS behavior_notes,
      COALESCE(pp.is_suspended, false)                                     AS is_suspended,
      COALESCE(pp.is_deleted,   false)                                     AS is_deleted,
      pp.deleted_at,
      -- Score de búsqueda
      CASE
        WHEN v_norm_query IS NULL THEN 0::float4
        ELSE GREATEST(
          word_similarity(v_norm_query,
            public.normalize_search(COALESCE(NULLIF(pp.full_name, ''), pr.full_name, '')))::real,
          word_similarity(v_norm_query,
            public.normalize_search(COALESCE(pp.nickname, '')))::real,
          word_similarity(v_norm_query,
            public.normalize_search(COALESCE(NULLIF(pp.email, ''), pr.email, '')))::real,
          CASE
            WHEN COALESCE(pp.dni, '') ILIKE '%' || v_raw_query || '%'
            THEN 1.0::real
            ELSE 0::real
          END,
          COALESCE(cs.max_child_score, 0::real)
        )::float4
      END AS score

    FROM public.parent_profiles pp
    LEFT JOIN public.schools  sc ON sc.id = pp.school_id
    LEFT JOIN public.profiles pr ON pr.id = pp.user_id
    LEFT JOIN LATERAL (
      SELECT
        MAX(word_similarity(v_norm_query,
          public.normalize_search(s.full_name)))::real AS max_child_score,
        BOOL_OR(
          public.normalize_search(COALESCE(s.full_name, '')) % v_norm_query
          OR public.normalize_search(COALESCE(s.full_name, '')) LIKE '%' || v_norm_query || '%'
        ) AS child_match
      FROM public.students s
      WHERE s.parent_id = pp.user_id
    ) cs ON TRUE

    WHERE
      -- ► NUEVA GUARDIA: excluye padres con soft delete activo
      COALESCE(pp.is_deleted, false) = false

      -- Filtro de sede: por columna directa O por herencia de alumnos activos
      AND (
        p_school_id IS NULL
        OR pp.school_id = p_school_id
        OR EXISTS (
          SELECT 1
          FROM public.students s2
          WHERE s2.parent_id  = pp.user_id
            AND s2.school_id  = p_school_id
            AND COALESCE(s2.is_active, true) = true
        )
      )

      -- Filtro de búsqueda
      AND (
        v_norm_query IS NULL
        OR public.normalize_search(COALESCE(NULLIF(pp.full_name, ''), pr.full_name, '')) % v_norm_query
        OR public.normalize_search(COALESCE(pp.nickname, '')) % v_norm_query
        OR public.normalize_search(COALESCE(NULLIF(pp.email, ''), pr.email, '')) % v_norm_query
        OR COALESCE(pp.dni, '') ILIKE '%' || v_raw_query || '%'
        OR COALESCE(cs.child_match, false)
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
      CASE WHEN v_norm_query IS NULL THEN c.full_name END ASC NULLS LAST,
      c.score DESC,
      c.full_name ASC
    LIMIT  v_limit
    OFFSET v_offset
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
    p.responsible_2_full_name,
    p.responsible_2_dni,
    p.responsible_2_document_type,
    p.responsible_2_phone_1,
    p.responsible_2_email,
    p.responsible_2_address,
    p.school_id,
    p.school_name,
    COALESCE(ch.children, '[]'::jsonb) AS children,
    p.created_at,
    p.behavior_profile,
    p.behavior_notes,
    p.is_suspended,
    p.is_deleted,
    p.deleted_at,
    p.score,
    p.total_count

  FROM paged p
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',             s.id,
        'full_name',      s.full_name,
        'grade',          s.grade,
        'section',        s.section,
        'photo_url',      s.photo_url,
        'free_account',   COALESCE(s.free_account,   true),
        -- ► CORRECCIÓN CRÍTICA: campo ausente en v5 → rompía UX Consumo Libre vs Solo Almuerzos
        'kiosk_disabled', COALESCE(s.kiosk_disabled, false),
        'limit_type',     COALESCE(s.limit_type, 'none'),
        'daily_limit',    s.daily_limit,
        'weekly_limit',   s.weekly_limit,
        'monthly_limit',  s.monthly_limit,
        'balance',        s.balance,
        'school_id',      s.school_id
      )
      ORDER BY s.full_name
    ) AS children
    FROM public.students s
    WHERE s.parent_id = p.user_id
      AND COALESCE(s.is_active, true) = true
  ) ch ON true;
END;
$$;

COMMENT ON FUNCTION public.search_parents_v3(text, uuid, int, int) IS
  'v6 (2026-05-27): excluye is_deleted; incluye campos mini-CRM; kiosk_disabled correctamente incluido en children. behavior_notes solo admins.';

GRANT EXECUTE ON FUNCTION public.search_parents_v3(text, uuid, int, int)
  TO authenticated;

COMMIT;

-- =============================================================================
-- Verificación post-ejecución (ejecutar manualmente si se desea confirmar):
--
-- SELECT column_name, data_type, column_default
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public'
--   AND  table_name   = 'parent_profiles'
--   AND  column_name  IN (
--     'behavior_profile','behavior_notes','is_suspended',
--     'is_deleted','deleted_at','deleted_by'
--   )
-- ORDER BY column_name;
--
-- SELECT id, full_name, behavior_profile, is_suspended, is_deleted
-- FROM   public.parent_profiles
-- LIMIT  5;
--
-- SELECT id, full_name, children->0->>'kiosk_disabled' AS kiosk_en_primer_hijo
-- FROM   public.search_parents_v3(NULL, NULL, 3, 0)
-- WHERE  (children->0) IS NOT NULL;
-- =============================================================================
