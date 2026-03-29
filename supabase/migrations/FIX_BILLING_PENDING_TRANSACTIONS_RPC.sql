-- FIX: Error 400 en Módulo de Cobranzas + soporte de rol supervisor_red
-- PROBLEMA: La query de transactions con select embebido (* + joins) genera una URL
-- demasiado larga para PostgREST (URI Too Long → 400 Bad Request).
-- SOLUCIÓN: RPC que ejecuta el JOIN en la BD y devuelve datos planos vía POST.
--
-- PARÁMETROS:
--   p_school_id        → filtra por sede (NULL = todas las sedes)
--   p_until_date       → filtra hasta esta fecha/hora (NULL = sin límite)
--   p_transaction_type → filtra por origen de la deuda:
--       NULL        → todo (cafetería + almuerzos)   — para admin_general
--       'cafeteria' → SOLO deudas de kiosco/POS      — para supervisor_red
--       'lunch'     → SOLO deudas de almuerzos
--
-- NOTA: ambos tipos tienen t.type = 'purchase'; la diferencia real es
-- si metadata->>'lunch_order_id' existe (almuerzo) o es NULL (cafetería).

DROP FUNCTION IF EXISTS get_billing_pending_transactions(uuid, timestamptz);
DROP FUNCTION IF EXISTS get_billing_pending_transactions(uuid, timestamptz, text);

CREATE OR REPLACE FUNCTION get_billing_pending_transactions(
  p_school_id         uuid        DEFAULT NULL,
  p_until_date        timestamptz DEFAULT NULL,
  p_transaction_type  text        DEFAULT NULL   -- 'cafeteria' | 'lunch' | NULL
)
RETURNS TABLE (
  id                  uuid,
  type                text,
  amount              numeric,
  payment_status      text,
  description         text,
  created_at          timestamptz,
  school_id           uuid,
  school_name         text,
  student_id          uuid,
  student_full_name   text,
  student_grade       text,
  student_section     text,
  student_parent_id   uuid,
  teacher_id          uuid,
  teacher_full_name   text,
  manual_client_name  text,
  metadata            jsonb,
  created_by          uuid,
  is_deleted          boolean
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
    t.description,
    t.created_at,
    t.school_id,
    s.name          AS school_name,
    t.student_id,
    st.full_name    AS student_full_name,
    st.grade        AS student_grade,
    st.section      AS student_section,
    st.parent_id    AS student_parent_id,
    t.teacher_id,
    tp.full_name    AS teacher_full_name,
    t.manual_client_name,
    t.metadata,
    t.created_by,
    t.is_deleted
  FROM transactions t
  LEFT JOIN schools          s  ON s.id  = t.school_id
  LEFT JOIN students         st ON st.id = t.student_id
  LEFT JOIN teacher_profiles tp ON tp.id = t.teacher_id
  WHERE t.type           = 'purchase'
    AND t.is_deleted     = false
    AND t.payment_status IN ('pending', 'partial')
    AND (p_school_id  IS NULL OR t.school_id  = p_school_id)
    AND (p_until_date IS NULL OR t.created_at <= p_until_date)
    -- Filtro por tipo de deuda:
    -- 'cafeteria' → solo transacciones SIN lunch_order_id (kiosco/POS)
    -- 'lunch'     → solo transacciones CON lunch_order_id
    -- NULL        → sin filtro (todo)
    AND (
      p_transaction_type IS NULL
      OR (p_transaction_type = 'cafeteria' AND (t.metadata->>'lunch_order_id') IS NULL)
      OR (p_transaction_type = 'lunch'     AND (t.metadata->>'lunch_order_id') IS NOT NULL)
    )
  ORDER BY t.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_billing_pending_transactions(uuid, timestamptz, text)
  TO authenticated, service_role;
