-- ============================================================
-- Lunch Orders Search Performance (RPC + índices)
-- ============================================================
-- Objetivo:
-- 1) Buscar pedidos por nombre sin escanear listas completas.
-- 2) Mantener filtros de fecha/sede/estado/tipo en DB.
-- 3) Devolver solo IDs para que el frontend reutilice su lógica actual.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Normalizador: insensible a mayúsculas y tildes (ver también 20260513 si afinás NFC).
CREATE OR REPLACE FUNCTION public.normalize_search(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.unaccent(
    lower(
      btrim(
        normalize(coalesce(t, '')::text, nfc)
      )
    )
  );
$$;

-- Índices para búsqueda por nombre de pedido manual y joins de personas.
CREATE INDEX IF NOT EXISTS idx_lunch_orders_manual_name_trgm
  ON public.lunch_orders
  USING gin (public.normalize_search(manual_name) gin_trgm_ops)
  WHERE manual_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lunch_orders_scope_by_date_school_status
  ON public.lunch_orders (order_date DESC, school_id, status, created_at DESC)
  WHERE is_cancelled = false;

CREATE INDEX IF NOT EXISTS idx_students_full_name_trgm_lunch_search
  ON public.students
  USING gin (public.normalize_search(full_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_teacher_profiles_full_name_trgm_lunch_search
  ON public.teacher_profiles
  USING gin (public.normalize_search(full_name) gin_trgm_ops);

-- Recrear siempre (idempotente): la versión anterior puede tener el bug del enum.
DROP FUNCTION IF EXISTS public.search_lunch_order_ids(text, date, date, uuid, text, text, int, int);

CREATE OR REPLACE FUNCTION public.search_lunch_order_ids(
  p_search      text,
  p_start_date  date,
  p_end_date    date,
  p_school_id   uuid DEFAULT NULL,
  p_status      text DEFAULT NULL,  -- texto puro, no enum: evita cast problemático
  p_person_type text DEFAULT 'all',
  p_limit       int  DEFAULT 3000,
  p_offset      int  DEFAULT 0
)
RETURNS TABLE (order_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_norm_search text;
BEGIN
  v_norm_search := public.normalize_search(COALESCE(p_search, ''));

  -- Evita consultas costosas para búsquedas demasiado cortas.
  IF length(v_norm_search) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT lo.id AS order_id
    FROM public.lunch_orders lo
    LEFT JOIN public.students st
      ON st.id = lo.student_id
    LEFT JOIN public.teacher_profiles tp
      ON tp.id = lo.teacher_id
    WHERE
      lo.order_date BETWEEN p_start_date AND p_end_date
      AND lo.is_cancelled = false
      -- payment_flow_state es ENUM: nunca comparar con '' directamente.
      -- Castear a text para comparación segura con cualquier valor o NULL.
      AND (lo.payment_flow_state IS NULL OR lo.payment_flow_state::text <> 'frozen_pending_payment')
      AND (p_school_id IS NULL OR lo.school_id = p_school_id)
      -- status también puede ser ENUM; castear a text para seguridad.
      AND (p_status IS NULL OR lo.status::text = p_status)
      AND (
        p_person_type = 'all'
        OR (p_person_type = 'students' AND lo.student_id IS NOT NULL)
        OR (p_person_type = 'teachers' AND lo.teacher_id IS NOT NULL)
      )
      AND (
        -- Trigrama (rápido con índice GIN) como filtro principal
        public.normalize_search(COALESCE(lo.manual_name, '')) % v_norm_search
        OR public.normalize_search(COALESCE(st.full_name,  '')) % v_norm_search
        OR public.normalize_search(COALESCE(tp.full_name,  '')) % v_norm_search
        -- LIKE basta: ambos lados ya pasaron por normalize_search (minúsculas).
        OR public.normalize_search(COALESCE(lo.manual_name, '')) LIKE '%' || v_norm_search || '%'
        OR public.normalize_search(COALESCE(st.full_name,  '')) LIKE '%' || v_norm_search || '%'
        OR public.normalize_search(COALESCE(tp.full_name,  '')) LIKE '%' || v_norm_search || '%'
      )
    ORDER BY lo.order_date DESC, lo.created_at DESC
    LIMIT  LEAST(GREATEST(COALESCE(p_limit,  3000), 1), 5000)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_lunch_order_ids(text, date, date, uuid, text, text, int, int)
  TO authenticated;
