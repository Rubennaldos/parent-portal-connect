-- ============================================================
-- BUSQUEDA INTELIGENTE DE USUARIOS — VERSION CORREGIDA
-- Corre este script en el Editor SQL de Supabase
-- (Si ya corriste la versión anterior, esto la reemplaza)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_term     TEXT;
  v_total    BIGINT;
BEGIN
  -- Solo superadmin y admin_general pueden usar esta función
  IF NOT EXISTS (
    SELECT 1 FROM profiles pr
    WHERE pr.id = auth.uid() AND pr.role IN ('superadmin', 'admin_general')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  -- Normalizar el término: sin tildes, en minúsculas
  IF p_term = '' THEN
    v_term := '%';
  ELSE
    v_term := '%' || unaccent(lower(trim(p_term))) || '%';
  END IF;

  -- Contar el total primero
  SELECT COUNT(*)
  INTO v_total
  FROM profiles pr
  WHERE
    (p_role = 'all' OR pr.role = p_role)
    AND (
      v_term = '%'
      OR unaccent(lower(COALESCE(pr.email, '')))     ILIKE v_term
      OR unaccent(lower(COALESCE(pr.full_name, ''))) ILIKE v_term
      OR pr.id IN (
          SELECT DISTINCT st.parent_id
          FROM students st
          WHERE st.parent_id IS NOT NULL
            AND unaccent(lower(st.full_name)) ILIKE v_term
      )
    );

  -- Devolver los registros paginados
  RETURN QUERY
  SELECT
    pr.id,
    pr.email,
    pr.full_name,
    pr.role,
    pr.school_id,
    pr.pos_number,
    pr.ticket_prefix,
    v_total AS total
  FROM profiles pr
  WHERE
    (p_role = 'all' OR pr.role = p_role)
    AND (
      v_term = '%'
      OR unaccent(lower(COALESCE(pr.email, '')))     ILIKE v_term
      OR unaccent(lower(COALESCE(pr.full_name, ''))) ILIKE v_term
      OR pr.id IN (
          SELECT DISTINCT st.parent_id
          FROM students st
          WHERE st.parent_id IS NOT NULL
            AND unaccent(lower(st.full_name)) ILIKE v_term
      )
    )
  ORDER BY pr.email
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_usuarios_admin(TEXT, TEXT, INT, INT) TO authenticated;
