-- ============================================================================
-- Extiende get_parent_gateway_payments_v1 con tickets pagados (debt_tx_ids)
-- Fecha: 2026-04-30
--
-- Objetivo:
--   Para pagos online IziPay, la transacción de recarga (credit) puede no traer
--   ticket_code propio. En ese caso, exponer los ticket_code de las deudas
--   saldadas en payment_sessions.debt_tx_ids.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_parent_gateway_payments_v1(uuid, int, int);

CREATE FUNCTION public.get_parent_gateway_payments_v1(
  p_parent_id  uuid,
  p_since_days int DEFAULT 180,
  p_limit      int DEFAULT 80
)
RETURNS TABLE (
  transaction_id           uuid,
  student_id               uuid,
  student_name             text,
  amount                   numeric,
  created_at               timestamptz,
  gateway_ref              text,
  ticket_code              text,
  paid_ticket_codes        text[],
  transaction_description  text,
  invoice_id               uuid,
  invoice_pdf_url          text,
  invoice_number           text,
  invoice_type             text,
  queue_invoice_type       text,
  queue_status             text,
  queue_pdf_url            text,
  queue_nubefact_ticket    text,
  queue_error_message      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: sesión no válida';
  END IF;

  IF auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: acceso restringido al titular';
  END IF;

  RETURN QUERY
  SELECT
    t.id                                                AS transaction_id,
    s.id                                                AS student_id,
    s.full_name                                         AS student_name,
    ABS(COALESCE(t.amount, 0))::numeric                 AS amount,
    t.created_at                                        AS created_at,
    (t.metadata->>'gateway_ref_id')::text               AS gateway_ref,
    t.ticket_code                                       AS ticket_code,
    paid.ticket_codes                                   AS paid_ticket_codes,
    t.description                                       AS transaction_description,
    t.invoice_id                                        AS invoice_id,
    inv.pdf_url                                         AS invoice_pdf_url,
    inv.full_number                                     AS invoice_number,
    CASE inv.document_type_code
      WHEN '01' THEN 'factura'
      WHEN '03' THEN 'boleta'
      ELSE inv.document_type_code
    END                                                 AS invoice_type,
    bq.invoice_type                                     AS queue_invoice_type,
    bq.status                                           AS queue_status,
    bq.pdf_url                                          AS queue_pdf_url,
    bq.nubefact_ticket                                  AS queue_nubefact_ticket,
    bq.error_message                                    AS queue_error_message
  FROM public.transactions t
  JOIN public.students s
    ON s.id = t.student_id
   AND s.parent_id = p_parent_id
  LEFT JOIN public.invoices inv
    ON inv.id = t.invoice_id
  LEFT JOIN LATERAL (
    SELECT
      q.status,
      q.pdf_url,
      q.nubefact_ticket,
      q.error_message,
      q.invoice_type
    FROM public.billing_queue q
    WHERE q.transaction_id = t.id
    ORDER BY q.created_at DESC
    LIMIT 1
  ) bq ON TRUE
  LEFT JOIN public.payment_sessions ps
    ON ps.gateway_reference = (t.metadata->>'gateway_ref_id')
   AND ps.student_id = t.student_id
  LEFT JOIN LATERAL (
    SELECT
      array_agg(DISTINCT dt.ticket_code ORDER BY dt.ticket_code)
      FILTER (WHERE dt.ticket_code IS NOT NULL) AS ticket_codes
    FROM public.transactions dt
    WHERE dt.id = ANY(COALESCE(ps.debt_tx_ids, ARRAY[]::uuid[]))
  ) paid ON TRUE
  WHERE t.payment_status = 'paid'
    AND t.type = 'recharge'
    AND t.is_deleted IS DISTINCT FROM TRUE
    AND (t.metadata->>'source_channel') = 'online_payment'
    AND t.created_at >= NOW() - make_interval(days => GREATEST(COALESCE(p_since_days, 180), 1))
  ORDER BY t.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 200);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_parent_gateway_payments_v1(uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.get_parent_gateway_payments_v1(uuid, int, int) IS
  'Pagos online IziPay del padre autenticado. Incluye tickets pagados desde '
  'payment_sessions.debt_tx_ids para casos donde la recarga no trae ticket_code.';
