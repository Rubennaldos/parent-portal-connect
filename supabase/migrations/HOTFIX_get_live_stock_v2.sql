-- ============================================================
-- HOTFIX: Aplicar en Supabase SQL Editor ahora mismo
-- Crea la función get_live_stock_v2 que el frontend necesita
-- ============================================================

-- 1) Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) Wrapper IMMUTABLE para unaccent (requerido para índices GIN)
CREATE OR REPLACE FUNCTION f_unaccent(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT public.unaccent('public.unaccent', t);
$$;

-- 3) Índices GIN para búsqueda veloz por nombre, categoría y sede
CREATE INDEX IF NOT EXISTS idx_products_name_unaccent_trgm
  ON products
  USING gin (f_unaccent(lower(COALESCE(name, ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_category_unaccent_trgm
  ON products
  USING gin (f_unaccent(lower(COALESCE(category, ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_schools_name_unaccent_trgm
  ON schools
  USING gin (f_unaccent(lower(COALESCE(name, ''))) gin_trgm_ops);

-- 4) RPC principal
CREATE OR REPLACE FUNCTION get_live_stock_v2(
  p_query     text    DEFAULT NULL,
  p_school_id uuid    DEFAULT NULL,
  p_estado    text    DEFAULT NULL,
  p_limit     integer DEFAULT 1000
)
RETURNS TABLE (
  product_id      uuid,
  school_id       uuid,
  nombre_producto text,
  categoria       text,
  sede            text,
  stock_actual    integer,
  min_stock       integer,
  estado          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      NULLIF(trim(COALESCE(p_query, '')), '')            AS raw_term,
      f_unaccent(lower(trim(COALESCE(p_query, ''))))     AS norm_term
  )
  SELECT
    p.id                                                   AS product_id,
    s.id                                                   AS school_id,
    p.name                                                 AS nombre_producto,
    COALESCE(NULLIF(trim(p.category), ''), 'Sin categoría') AS categoria,
    s.name                                                 AS sede,
    ps.current_stock                                       AS stock_actual,
    COALESCE(p.min_stock, 0)                               AS min_stock,
    CASE
      WHEN ps.current_stock <= 0                           THEN 'Agotado'
      WHEN ps.current_stock < COALESCE(p.min_stock, 0)    THEN 'Bajo Stock'
      ELSE 'OK'
    END                                                    AS estado
  FROM product_stock ps
  JOIN products p ON p.id = ps.product_id
  JOIN schools  s ON s.id = ps.school_id
  CROSS JOIN q
  WHERE p.active      = true
    AND ps.is_enabled = true
    AND (p_school_id IS NULL OR ps.school_id = p_school_id)
    AND (
      q.raw_term IS NULL
      OR f_unaccent(lower(COALESCE(p.name,     ''))) ILIKE '%' || q.norm_term || '%'
      OR f_unaccent(lower(COALESCE(p.category, ''))) ILIKE '%' || q.norm_term || '%'
      OR f_unaccent(lower(COALESCE(s.name,     ''))) ILIKE '%' || q.norm_term || '%'
    )
    AND (
      p_estado IS NULL
      OR p_estado = ''
      OR (
        CASE
          WHEN ps.current_stock <= 0                        THEN 'Agotado'
          WHEN ps.current_stock < COALESCE(p.min_stock, 0) THEN 'Bajo Stock'
          ELSE 'OK'
        END
      ) = p_estado
    )
  ORDER BY
    ps.current_stock ASC,
    p.name           ASC,
    s.name           ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
$$;

GRANT EXECUTE ON FUNCTION get_live_stock_v2(text, uuid, text, integer)
  TO authenticated, service_role;

SELECT 'get_live_stock_v2 instalado correctamente' AS resultado;
