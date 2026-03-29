-- FIX: fetchPaidTransactions y BillingReportsTab usan select con embedded joins
-- que generan URLs largas → 400 Bad Request.
-- SOLUCIÓN: RPC paginado que devuelve datos planos vía POST.

CREATE OR REPLACE FUNCTION get_billing_paid_transactions(
  p_school_id     uuid        DEFAULT NULL,
  p_status        text        DEFAULT NULL,   -- 'paid' | 'partial' | NULL = todos
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_search_term   text        DEFAULT NULL,   -- busca en descripción, ticket_code, manual_client_name
  p_offset        integer     DEFAULT 0,
  p_limit         integer     DEFAULT 30
)
RETURNS TABLE (
  id                  uuid,
  type                text,
  amount              numeric,
  payment_status      text,
  payment_method      text,
  operation_number    text,
  description         text,
  created_at          timestamptz,
  school_id           uuid,
  school_name         text,
  student_id          uuid,
  student_full_name   text,
  student_parent_id   uuid,
  teacher_id          uuid,
  teacher_full_name   text,
  manual_client_name  text,
  metadata            jsonb,
  ticket_code         text,
  created_by          uuid,
  paid_with_mixed     boolean,
  cash_amount         numeric,
  card_amount         numeric,
  yape_amount         numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.type,
    t.amount,
    t.payment_status,
    t.payment_method,
    t.operation_number,
    t.description,
    t.created_at,
    t.school_id,
    s.name          AS school_name,
    t.student_id,
    st.full_name    AS student_full_name,
    st.parent_id    AS student_parent_id,
    t.teacher_id,
    tp.full_name    AS teacher_full_name,
    t.manual_client_name,
    t.metadata,
    t.ticket_code,
    t.created_by,
    t.paid_with_mixed,
    t.cash_amount,
    t.card_amount,
    t.yape_amount
  FROM transactions t
  LEFT JOIN schools          s  ON s.id  = t.school_id
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status != 'cancelled'
    AND (p_school_id  IS NULL OR t.school_id  = p_school_id)
    AND (p_status     IS NULL OR t.payment_status = p_status)
    AND (p_date_from  IS NULL OR t.created_at >= p_date_from)
    AND (p_date_to    IS NULL OR t.created_at <= p_date_to)
    AND (
      p_search_term IS NULL
      OR t.description         ILIKE '%' || p_search_term || '%'
      OR t.ticket_code         ILIKE '%' || p_search_term || '%'
      OR t.manual_client_name  ILIKE '%' || p_search_term || '%'
      OR st.full_name          ILIKE '%' || p_search_term || '%'
      OR tp.full_name          ILIKE '%' || p_search_term || '%'
    )
  ORDER BY t.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- Función para contar total (sin traer datos)
CREATE OR REPLACE FUNCTION count_billing_paid_transactions(
  p_school_id     uuid        DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_date_from     timestamptz DEFAULT NULL,
  p_date_to       timestamptz DEFAULT NULL,
  p_search_term   text        DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)
  FROM transactions t
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status != 'cancelled'
    AND (p_school_id  IS NULL OR t.school_id  = p_school_id)
    AND (p_status     IS NULL OR t.payment_status = p_status)
    AND (p_date_from  IS NULL OR t.created_at >= p_date_from)
    AND (p_date_to    IS NULL OR t.created_at <= p_date_to)
    AND (
      p_search_term IS NULL
      OR t.description         ILIKE '%' || p_search_term || '%'
      OR t.ticket_code         ILIKE '%' || p_search_term || '%'
      OR t.manual_client_name  ILIKE '%' || p_search_term || '%'
      OR st.full_name          ILIKE '%' || p_search_term || '%'
      OR tp.full_name          ILIKE '%' || p_search_term || '%'
    );
$$;

GRANT EXECUTE ON FUNCTION get_billing_paid_transactions(uuid, text, timestamptz, timestamptz, text, integer, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION count_billing_paid_transactions(uuid, text, timestamptz, timestamptz, text)
  TO authenticated, service_role;
