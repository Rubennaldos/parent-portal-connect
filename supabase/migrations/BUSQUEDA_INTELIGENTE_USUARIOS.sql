-- ============================================================
-- BUSQUEDA INTELIGENTE — VERSIÓN FINAL (sin conflictos)
-- Corre este script en el Editor SQL de Supabase
-- ============================================================

-- Activar extensión de tildes
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Borrar función anterior para evitar conflictos
DROP FUNCTION IF EXISTS public.buscar_usuarios_admin(TEXT, TEXT, INT, INT);

-- Nueva versión que devuelve JSON (sin conflicto de nombres de columnas)
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
