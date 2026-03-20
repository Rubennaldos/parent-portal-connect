-- ============================================================
-- BUSQUEDA INTELIGENTE DE USUARIOS — VERSION SIMPLIFICADA
-- Corre este script en el Editor SQL de Supabase
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.buscar_usuarios_admin(
  p_term    TEXT    DEFAULT '',
  p_role    TEXT    DEFAULT 'all',
  p_offset  INT     DEFAULT 0,
  p_limit   INT     DEFAULT 50
)
RETURNS TABLE (
  id             UUID,
  email          TEXT,
  full_name      TEXT,
  role           TEXT,
  school_id      UUID,
  pos_number     INT,
  ticket_prefix  TEXT,
  total          BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.id,
    pr.email,
    pr.full_name,
    pr.role,
    pr.school_id,
    pr.pos_number,
    pr.ticket_prefix,
    COUNT(*) OVER() AS total
  FROM profiles pr
  WHERE
    (p_role = 'all' OR pr.role = p_role)
    AND (
      p_term = ''
      OR unaccent(lower(COALESCE(pr.email, '')))     ILIKE '%' || unaccent(lower(trim(p_term))) || '%'
      OR unaccent(lower(COALESCE(pr.full_name, ''))) ILIKE '%' || unaccent(lower(trim(p_term))) || '%'
      OR pr.id IN (
          SELECT DISTINCT st.parent_id
          FROM students st
          WHERE st.parent_id IS NOT NULL
            AND unaccent(lower(st.full_name)) ILIKE '%' || unaccent(lower(trim(p_term))) || '%'
      )
    )
  ORDER BY pr.email
  LIMIT  p_limit
  OFFSET p_offset
$$;

GRANT EXECUTE ON FUNCTION public.buscar_usuarios_admin(TEXT, TEXT, INT, INT) TO authenticated;
