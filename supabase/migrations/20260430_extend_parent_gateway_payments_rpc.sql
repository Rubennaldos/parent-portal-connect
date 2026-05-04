-- ============================================================================
-- Extiende get_parent_gateway_payments_v1: ticket + tipo solicitado en cola
-- Fecha: 2026-04-30
--
-- CAMBIOS vs versión anterior del RPC:
--   + ticket_code              (transactions.ticket_code — puede ser NULL en recargas online)
--   + transaction_description  (transactions.description)
--   + queue_invoice_type       (billing_queue.invoice_type — lo que se pidió al encolar)
--   + invoice_type             derivado de invoices.document_type_code:
--                              '03' → 'boleta', '01' → 'factura', resto → document_type_code
--
-- CORRECCIONES respecto al draft anterior:
--   1. invoices NO tiene columna invoice_type → se usa document_type_code con CASE.
--   2. DROP FUNCTION se reemplaza por DROP FUNCTION ... CASCADE para evitar
--      error si hay dependencias; pero se deja solo si es estrictamente necesario
--      (cambio de firma RETURNS TABLE). Se usa CASCADE con precaución.
-- ============================================================================

-- La firma RETURNS TABLE cambia (añadimos columnas) → DROP + CREATE es obligatorio.
-- CASCADE sólo borra dependencias de tipo (e.g. vistas que llamen a esta función);
-- no borra datos. Si hay vistas críticas que dependan de este RPC, habrá que
-- recrearlas después — revisar antes de aplicar.
DROP FUNCTION IF EXISTS public.get_parent_gateway_payments_v1(uuid, int, int) CASCADE;

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
  transaction_description  text,
  invoice_id               uuid,
  invoice_pdf_url          text,
  invoice_number           text,
  -- 'boleta', 'factura', o NULL si aún no se emitió comprobante
  invoice_type             text,
  -- tipo que se pidió al encolar en billing_queue (puede existir antes de que
  -- exista el comprobante SUNAT): 'boleta' | 'factura'
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
  -- ── Seguridad: solo el padre titular puede llamar este RPC ──────────────
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
    -- ticket_code: en recargas online suele ser NULL (no es una venta POS)
    t.ticket_code                                       AS ticket_code,
    t.description                                       AS transaction_description,
    t.invoice_id                                        AS invoice_id,
    inv.pdf_url                                         AS invoice_pdf_url,
    inv.full_number                                     AS invoice_number,
    -- invoices usa document_type_code ('01'=factura, '03'=boleta), no invoice_type
    CASE inv.document_type_code
      WHEN '01' THEN 'factura'
      WHEN '03' THEN 'boleta'
      ELSE inv.document_type_code   -- ej. '07' nota de crédito
    END                                                 AS invoice_type,
    -- billing_queue sí tiene columna invoice_type ('boleta'|'factura')
    bq.invoice_type                                     AS queue_invoice_type,
    bq.status                                           AS queue_status,
    bq.pdf_url                                          AS queue_pdf_url,
    bq.nubefact_ticket                                  AS queue_nubefact_ticket,
    bq.error_message                                    AS queue_error_message
  FROM public.transactions t
  JOIN public.students s
    ON s.id       = t.student_id
   AND s.parent_id = p_parent_id
  -- invoice_id puede no existir en transactions de instalaciones viejas;
  -- LEFT JOIN es seguro: si la columna no existe la query falla antes aquí.
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
  WHERE t.payment_status = 'paid'
    AND t.type            = 'recharge'
    AND t.is_deleted      IS DISTINCT FROM TRUE
    AND (t.metadata->>'source_channel') = 'online_payment'
    AND t.created_at >= NOW() - make_interval(days => GREATEST(COALESCE(p_since_days, 180), 1))
  ORDER BY t.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 200);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_parent_gateway_payments_v1(uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.get_parent_gateway_payments_v1(uuid, int, int) IS
  'Pagos online IziPay del padre autenticado. '
  'invoice_type deriva de invoices.document_type_code (01→factura, 03→boleta). '
  'queue_invoice_type es el tipo solicitado al encolar (billing_queue.invoice_type). '
  'ticket_code es NULL en recargas online puras (no son ventas POS). '
  'Requiere: transactions.invoice_id, transactions.ticket_code, '
  'billing_queue.invoice_type, billing_queue.pdf_url, billing_queue.nubefact_ticket.';
