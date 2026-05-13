-- ============================================================
-- Gestión de pedidos: visibilidad de profesores sin pasarela
-- ============================================================
-- Regla:
-- - Si el pedido tiene teacher_id, debe ser visible aunque esté
--   en frozen_pending_payment (docentes no usan pasarela).
-- - Para el resto, se mantiene el bloqueo de frozen_pending_payment.

CREATE OR REPLACE FUNCTION public.search_lunch_order_ids(
  p_search      text,
  p_start_date  date,
  p_end_date    date,
  p_school_id   uuid DEFAULT NULL,
  p_status      text DEFAULT NULL,
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
      AND (
        lo.teacher_id IS NOT NULL
        OR lo.payment_flow_state IS NULL
        OR lo.payment_flow_state::text <> 'frozen_pending_payment'
      )
      AND (p_school_id IS NULL OR lo.school_id = p_school_id)
      AND (p_status IS NULL OR lo.status::text = p_status)
      AND (
        p_person_type = 'all'
        OR (p_person_type = 'students' AND lo.student_id IS NOT NULL)
        OR (p_person_type = 'teachers' AND lo.teacher_id IS NOT NULL)
      )
      AND (
        public.normalize_search(COALESCE(lo.manual_name, '')) % v_norm_search
        OR public.normalize_search(COALESCE(st.full_name,  '')) % v_norm_search
        OR public.normalize_search(COALESCE(tp.full_name,  '')) % v_norm_search
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
