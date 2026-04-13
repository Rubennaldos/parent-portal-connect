-- ══════════════════════════════════════════════════════════════════════════════
-- RPC: get_payment_history
-- v7 (2026-04-13): Agrega credit_note_number y credit_note_pdf_url para pagos anulados.
--
-- PROBLEMA ANTERIOR (v4/v5):
--   El LATERAL se evaluaba para TODOS los registros filtrados (~5440) antes
--   de aplicar el LIMIT. Con miles de filas eso causa statement timeout (500).
--
-- SOLUCIÓN v6:
--   Subquery interna pagina primero (solo nombre + reference_code en el search).
--   El LATERAL corre solo para los ~20 registros de la página actual.
--   Resultado: la función pasa de ~30s a <1s por página.
--
-- RUTAS DE ENLACE recharge_requests → transactions (LATERAL):
--   Path 1: t.metadata->>'recharge_request_id' = rr.id::text
--   Path 2: t.id = ANY(rr.paid_transaction_ids)
--   Path 3: (t.metadata->>'lunch_order_id')::uuid = ANY(rr.lunch_order_ids)
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_payment_history(TEXT, INT, INT);

CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── Crear tabla invoices si no existe ────────────────────────────────────────
-- La función usa LEFT JOIN con invoices. Si aún no fue creada, el LEFT JOIN
-- simplemente devuelve NULL (= sin boleta electrónica = 'Ticket' o 'Pendiente').
CREATE TABLE IF NOT EXISTS invoices (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id      UUID        REFERENCES transactions(id) ON DELETE SET NULL,
  school_id           UUID,
  document_type_code  TEXT        NOT NULL DEFAULT '03',
  serie               TEXT,
  numero              INT,
  full_number         TEXT,
  sunat_status        TEXT        DEFAULT 'pending',
  pdf_url             TEXT,
  xml_url             TEXT,
  original_invoice_id UUID,
  metadata            JSONB       DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_transaction_id ON invoices(transaction_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sunat_status   ON invoices(sunat_status);

-- ── Índice crítico para Path 1 del LATERAL ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tx_metadata_rr_id
  ON transactions ((metadata->>'recharge_request_id'));

-- ── Índice para el filtro principal (status + fecha) ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_rr_status_approved_at
  ON recharge_requests (status, approved_at DESC NULLS LAST)
  WHERE status IN ('approved', 'voided');

CREATE OR REPLACE FUNCTION get_payment_history(
  p_search  TEXT    DEFAULT '',
  p_limit   INT     DEFAULT 20,
  p_offset  INT     DEFAULT 0
)
RETURNS TABLE (
  id              UUID,
  approved_at     TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ,
  status          TEXT,
  student_name    TEXT,
  student_grade   TEXT,
  student_section TEXT,
  school_name     TEXT,
  concepto        TEXT,
  amount          NUMERIC,
  payment_method  TEXT,
  reference_code  TEXT,
  source_channel  TEXT,
  invoice_number       TEXT,
  invoice_type         TEXT,
  invoice_pdf_url      TEXT,
  credit_note_number   TEXT,
  credit_note_pdf_url  TEXT,
  total_count          BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rr.id::UUID,
    COALESCE(rr.approved_at, rr.created_at)::TIMESTAMPTZ,
    rr.voided_at::TIMESTAMPTZ,
    rr.status::TEXT,
    s.full_name::TEXT,
    COALESCE(s.grade,   '')::TEXT,
    COALESCE(s.section, '')::TEXT,
    COALESCE(sc.name,   'Sin sede')::TEXT,

    CASE rr.request_type
      WHEN 'recharge'      THEN 'Recarga de saldo'
      WHEN 'lunch_payment' THEN 'Pago de almuerzos'
      WHEN 'debt_payment'  THEN 'Pago de deuda'
      ELSE COALESCE(rr.description, 'Pago')
    END::TEXT,

    rr.amount::NUMERIC,
    rr.payment_method::TEXT,
    rr.reference_code::TEXT,

    -- Canal inferido desde request_type (recharge_requests no tiene metadata)
    CASE rr.request_type
      WHEN 'recharge'      THEN 'parent_web'
      WHEN 'lunch_payment' THEN 'lunch_calendar'
      WHEN 'debt_payment'  THEN 'admin_cxc'
      ELSE                      'admin_cxc'
    END::TEXT,

    -- Comprobante: Boleta/Factura > Ticket > '—'
    COALESCE(ti.inv_full_number, ti.ticket_code, '—')::TEXT,

    CASE
      WHEN ti.document_type_code = '01' THEN 'Factura'
      WHEN ti.document_type_code = '03' THEN 'Boleta'
      WHEN ti.ticket_code IS NOT NULL   THEN 'Ticket'
      ELSE                                   'Pendiente'
    END::TEXT,

    ti.inv_pdf_url::TEXT,
    -- Nota de Crédito (solo para pagos anulados con boleta original)
    ti.nc_full_number::TEXT,
    ti.nc_pdf_url::TEXT,
    q.total_count::BIGINT

  -- ── Subquery: filtra y pagina ANTES del LATERAL ────────────────────────────
  -- De esta forma el LATERAL solo corre para los ~20 registros de la página.
  FROM (
    SELECT
      r2.id,
      COUNT(*) OVER()                            AS total_count,
      COALESCE(r2.approved_at, r2.created_at)    AS sort_at
    FROM recharge_requests r2
    JOIN students s2 ON s2.id = r2.student_id
    WHERE r2.status IN ('approved', 'voided')
      AND (
        p_search = ''
        OR unaccent(LOWER(s2.full_name))              ILIKE '%' || unaccent(LOWER(p_search)) || '%'
        OR LOWER(COALESCE(r2.reference_code, ''))     ILIKE '%' || LOWER(p_search)           || '%'
      )
    ORDER BY COALESCE(r2.approved_at, r2.created_at) DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ) q

  JOIN  recharge_requests rr ON rr.id = q.id
  JOIN  students  s  ON s.id  = rr.student_id
  LEFT JOIN schools sc ON sc.id = rr.school_id

  -- ── LATERAL: triple ruta + Nota de Crédito, solo para los ~20 registros paginados ──
  LEFT JOIN LATERAL (
    SELECT
      t.ticket_code,
      inv.id                 AS inv_id,
      inv.full_number        AS inv_full_number,
      inv.document_type_code,
      inv.pdf_url            AS inv_pdf_url,
      -- Nota de Crédito vinculada a la boleta/factura original (para pagos anulados)
      -- nc.original_invoice_id = inv.id → la NC que cancela esta boleta
      nc.full_number         AS nc_full_number,
      nc.pdf_url             AS nc_pdf_url,
      nc.sunat_status        AS nc_sunat_status
    FROM   transactions t
    -- ── Boleta/Factura: búsqueda en DOS rutas ────────────────────────────────
    -- Ruta A: invoices.transaction_id = t.id
    --   → se setea cuando generate-document recibe transaction_id (flujo split)
    -- Ruta B: t.invoice_id = invoices.id
    --   → se setea en VoucherApproval después de emitir (flujo normal)
    -- Necesitamos ambas porque el flujo normal de VoucherApproval no pasa
    -- transaction_id a generate-document, dejando invoices.transaction_id NULL.
    LEFT   JOIN invoices inv
           ON  (inv.transaction_id = t.id OR inv.id = t.invoice_id)
           AND inv.document_type_code IN ('01', '03')
           AND inv.sunat_status       <> 'voided'
    -- NC vinculada a la boleta/factura encontrada arriba
    LEFT   JOIN invoices nc
           ON  nc.original_invoice_id = inv.id
           AND nc.document_type_code  = '07'
    WHERE  t.is_deleted = false
      AND  (
        -- Path 1: metadata (recargas + aprobaciones con process_traditional_voucher_approval v4+)
        t.metadata->>'recharge_request_id' = rr.id::text
        -- Path 2: debt_payment con paid_transaction_ids explícitos
        OR (
          rr.paid_transaction_ids IS NOT NULL
          AND array_length(rr.paid_transaction_ids, 1) > 0
          AND t.id = ANY(rr.paid_transaction_ids)
        )
        -- Path 3: lunch_payment via lunch_order_ids
        OR (
          rr.lunch_order_ids IS NOT NULL
          AND array_length(rr.lunch_order_ids, 1) > 0
          AND (t.metadata->>'lunch_order_id')::uuid = ANY(rr.lunch_order_ids)
        )
      )
    ORDER BY (inv.id IS NOT NULL) DESC,   -- boleta electrónica primero
             t.created_at ASC
    LIMIT  1
  ) ti ON true

  ORDER BY q.sort_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_payment_history(TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION get_payment_history IS
  'v8 (2026-04-13): JOIN boleta por dos rutas (inv.transaction_id Y t.invoice_id).
   La NC se obtiene via invoices.original_invoice_id apuntando a la boleta original.
   Paginación antes del LATERAL (resuelve timeout con 5000+ registros).
   Solo para uso interno — no exponer a roles de padre.';

NOTIFY pgrst, 'reload schema';
SELECT 'get_payment_history v8 OK — NC + dual invoice join' AS resultado;
