-- ============================================================
-- BUSQUEDA INTELIGENTE DE USUARIOS (sin tildes, sin mayúsculas)
-- Corre este script UNA SOLA VEZ en el Editor SQL de Supabase
-- ============================================================

-- Activar extensión de tildes (ya viene en Supabase, solo hay que activarla)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Función de búsqueda inteligente para el panel de SuperAdmin
-- Busca por email, nombre del padre Y nombre de cualquier hijo
-- Sin importar tildes ni mayúsculas
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
  v_term TEXT;
BEGIN
  -- Solo superadmin y admin_general pueden usar esta función
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('superadmin', 'admin_general')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  -- Normalizar el término: sin tildes, en minúsculas
  v_term := '%' || unaccent(lower(trim(p_term))) || '%';

  RETURN QUERY
  WITH matched_ids AS (
    SELECT p.id
    FROM profiles p
    WHERE
      -- Filtro de rol
      (p_role = 'all' OR p.role = p_role)
      AND
      -- Si no hay término, devolver todos; si hay término, buscar en todo
      (
        p_term = ''
        OR unaccent(lower(COALESCE(p.email, '')))     ILIKE v_term
        OR unaccent(lower(COALESCE(p.full_name, ''))) ILIKE v_term
        OR p.id IN (
          -- Buscar por nombre de hijo
          SELECT DISTINCT parent_id
          FROM students
          WHERE parent_id IS NOT NULL
            AND unaccent(lower(full_name)) ILIKE v_term
        )
      )
  )
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.role,
    p.school_id,
    p.pos_number,
    p.ticket_prefix,
    (SELECT COUNT(*) FROM matched_ids) AS total
  FROM profiles p
  WHERE p.id IN (SELECT id FROM matched_ids)
  ORDER BY p.email
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- Dar permiso al frontend
GRANT EXECUTE ON FUNCTION public.buscar_usuarios_admin(TEXT, TEXT, INT, INT) TO authenticated;
