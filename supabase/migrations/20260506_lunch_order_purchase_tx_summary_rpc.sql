-- ============================================================
-- Rendimiento almuerzos: índice en metadata->>'lunch_order_id'
-- + RPC get_lunch_order_purchase_tx_summary
--
-- Evita sequential scan al filtrar transacciones por pedido
-- (antes: .in(student_id) + filtro en cliente por metadata).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_transactions_purchase_metadata_lunch_order_id
  ON public.transactions ((metadata->>'lunch_order_id'))
  WHERE type = 'purchase'
    AND COALESCE(is_deleted, false) = false
    AND (metadata->>'lunch_order_id') IS NOT NULL;

COMMENT ON INDEX public.idx_transactions_purchase_metadata_lunch_order_id IS
  'Búsqueda por pedido de almuerzo en transactions.metadata (Gestión de pedidos / calendario).';

DROP FUNCTION IF EXISTS public.get_lunch_order_purchase_tx_summary(uuid[], uuid);

-- Una fila por lunch_order_id: prioriza paid > partial > pending > (cancelled si p_include_cancelled); luego created_at DESC.
CREATE OR REPLACE FUNCTION public.get_lunch_order_purchase_tx_summary(
  p_lunch_order_ids uuid[],
  p_school_id          uuid DEFAULT NULL,
  p_include_cancelled  boolean DEFAULT false
)
RETURNS TABLE (
  lunch_order_id       uuid,
  ticket_code          text,
  payment_status       text,
  payment_method       text,
  amount_abs           numeric,
  tx_metadata_source   text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT DISTINCT u AS lid
    FROM unnest(p_lunch_order_ids) AS u
    WHERE cardinality(p_lunch_order_ids) > 0
  ),
  cand AS (
    SELECT
      (t.metadata->>'lunch_order_id')::uuid AS lo_id,
      t.ticket_code,
      t.payment_status::text,
      t.payment_method::text,
      t.amount,
      t.metadata->>'source' AS src,
      t.created_at,
      CASE t.payment_status
        WHEN 'paid' THEN 0
        WHEN 'partial' THEN 1
        WHEN 'pending' THEN 2
        WHEN 'cancelled' THEN 4
        ELSE 3
      END AS pri
    FROM public.transactions t
    JOIN ids ON ids.lid = (t.metadata->>'lunch_order_id')::uuid
    WHERE t.type = 'purchase'
      AND COALESCE(t.is_deleted, false) = false
      AND (p_include_cancelled OR t.payment_status IS DISTINCT FROM 'cancelled')
      AND (p_school_id IS NULL OR t.school_id = p_school_id)
  ),
  ranked AS (
    SELECT DISTINCT ON (c.lo_id)
      c.lo_id,
      c.ticket_code,
      c.payment_status,
      c.payment_method,
      c.amount,
      c.src,
      c.created_at
    FROM cand c
    ORDER BY c.lo_id, c.pri ASC, c.created_at DESC
  )
  SELECT
    r.lo_id AS lunch_order_id,
    r.ticket_code,
    r.payment_status,
    r.payment_method,
    ROUND(ABS(r.amount::numeric), 2) AS amount_abs,
    r.src AS tx_metadata_source
  FROM ranked r;
$$;

COMMENT ON FUNCTION public.get_lunch_order_purchase_tx_summary(uuid[], uuid, boolean) IS
  'Resumen de pago por pedido de almuerzo (transactions purchase vinculadas por metadata.lunch_order_id).';

GRANT EXECUTE ON FUNCTION public.get_lunch_order_purchase_tx_summary(uuid[], uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lunch_order_purchase_tx_summary(uuid[], uuid, boolean) TO service_role;
