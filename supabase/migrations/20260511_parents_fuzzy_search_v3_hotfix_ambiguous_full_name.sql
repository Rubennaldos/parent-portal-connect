-- HOTFIX: search_parents_v3 error 42702 (full_name ambiguo)
-- Motivo: ORDER BY usaba "full_name" sin alias en una función RETURNS TABLE,
-- lo que colisiona con variable de salida de PL/pgSQL.

CREATE OR REPLACE FUNCTION public.search_parents_v3(
  p_query text DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  full_name text,
  nickname text,
  dni text,
  phone_1 text,
  phone_2 text,
  email text,
  address text,
  responsible_2_full_name text,
  responsible_2_dni text,
  responsible_2_document_type text,
  responsible_2_phone_1 text,
  responsible_2_email text,
  responsible_2_address text,
  school_id uuid,
  school_name text,
  children jsonb,
  created_at timestamptz,
  score float4,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_raw_query text := COALESCE(trim(p_query), '');
  v_norm_query text := NULL;
BEGIN
  IF v_raw_query <> '' THEN
    v_norm_query := public.normalize_search(v_raw_query);
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      pp.id,
      pp.user_id,
      pp.full_name::text,
      pp.nickname::text,
      pp.dni::text,
      pp.phone_1::text,
      pp.phone_2::text,
      pp.email::text,
      pp.address::text,
      pp.responsible_2_full_name::text,
      pp.responsible_2_dni::text,
      pp.responsible_2_document_type::text,
      pp.responsible_2_phone_1::text,
      pp.responsible_2_email::text,
      pp.responsible_2_address::text,
      pp.school_id,
      sc.name::text AS school_name,
      pp.created_at::timestamptz AS created_at,
      CASE
        WHEN v_norm_query IS NULL THEN 0::float4
        ELSE GREATEST(
          word_similarity(v_norm_query, public.normalize_search(COALESCE(pp.full_name, '')))::real,
          word_similarity(v_norm_query, public.normalize_search(COALESCE(pp.nickname, '')))::real,
          word_similarity(v_norm_query, public.normalize_search(COALESCE(pp.email, '')))::real,
          CASE WHEN COALESCE(pp.dni, '') ILIKE '%' || v_raw_query || '%' THEN 1.0::real ELSE 0::real END,
          COALESCE(cs.max_child_score, 0::real)
        )::float4
      END AS score
    FROM public.parent_profiles pp
    LEFT JOIN public.schools sc ON sc.id = pp.school_id
    LEFT JOIN LATERAL (
      SELECT
        MAX(word_similarity(v_norm_query, public.normalize_search(s.full_name)))::real AS max_child_score,
        BOOL_OR(
          public.normalize_search(COALESCE(s.full_name, '')) % v_norm_query
          OR public.normalize_search(COALESCE(s.full_name, '')) LIKE '%' || v_norm_query || '%'
        ) AS child_match
      FROM public.students s
      WHERE s.parent_id = pp.user_id
    ) cs ON TRUE
    WHERE
      (p_school_id IS NULL OR pp.school_id = p_school_id)
      AND (
        v_norm_query IS NULL
        OR public.normalize_search(COALESCE(pp.full_name, '')) % v_norm_query
        OR public.normalize_search(COALESCE(pp.nickname, '')) % v_norm_query
        OR public.normalize_search(COALESCE(pp.email, '')) % v_norm_query
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
    LIMIT v_limit
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
    p.score,
    p.total_count
  FROM paged p
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'full_name', s.full_name,
        'grade', s.grade,
        'section', s.section,
        'photo_url', s.photo_url,
        'free_account', s.free_account,
        'limit_type', s.limit_type,
        'daily_limit', s.daily_limit,
        'weekly_limit', s.weekly_limit,
        'monthly_limit', s.monthly_limit,
        'balance', s.balance,
        'school_id', s.school_id
      )
      ORDER BY s.full_name
    ) AS children
    FROM public.students s
    WHERE s.parent_id = p.user_id
      AND COALESCE(s.is_active, true) = true
  ) ch ON true;
END;
$$;
