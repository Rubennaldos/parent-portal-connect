-- ============================================================
-- DIAGNÓSTICO DEFINITIVO: ¿Por qué Comprobante muestra "Pendiente"?
-- Ejecutar CADA TEST por separado en Supabase Studio → SQL Editor
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- TEST A: ¿Hay transacciones con ticket_code?
-- Si da 0 → ningún pago del kiosco tiene número de ticket
-- ══════════════════════════════════════════════════════════════
SELECT
  COUNT(*)                                                  AS total_transacciones,
  COUNT(*) FILTER (WHERE ticket_code IS NOT NULL
                     AND ticket_code <> '')                 AS con_ticket_code,
  COUNT(*) FILTER (WHERE type = 'purchase')                 AS tipo_purchase,
  COUNT(*) FILTER (WHERE type = 'recharge')                 AS tipo_recharge
FROM transactions
WHERE is_deleted = false;

-- ══════════════════════════════════════════════════════════════
-- TEST B: Para los últimos 5 recharge_requests, ¿qué tienen vinculado?
-- Revela si paid_transaction_ids está lleno o vacío
-- ══════════════════════════════════════════════════════════════
SELECT
  rr.id,
  rr.request_type,
  rr.status,
  rr.amount,
  rr.reference_code,
  -- ¿Cuántas tx hay en paid_transaction_ids?
  array_length(rr.paid_transaction_ids, 1)           AS tx_en_paid_ids,
  -- ¿Cuántas tx encontraría el Path 1 (metadata)?
  (SELECT COUNT(*) FROM transactions t
   WHERE t.is_deleted = false
     AND t.metadata->>'recharge_request_id' = rr.id::text) AS path1_count,
  -- ¿Alguna de ellas tiene ticket_code?
  (SELECT t.ticket_code FROM transactions t
   WHERE t.is_deleted = false
     AND t.metadata->>'recharge_request_id' = rr.id::text
   LIMIT 1)                                          AS path1_ticket,
  -- ¿Alguna tx en paid_transaction_ids tiene ticket_code?
  (SELECT t.ticket_code FROM transactions t
   WHERE t.is_deleted = false
     AND rr.paid_transaction_ids IS NOT NULL
     AND t.id = ANY(rr.paid_transaction_ids)
   LIMIT 1)                                          AS path2_ticket
FROM recharge_requests rr
WHERE rr.status IN ('approved', 'voided')
ORDER BY rr.approved_at DESC NULLS LAST
LIMIT 5;

-- ══════════════════════════════════════════════════════════════
-- TEST C: Ver la metadata de las transactions vinculadas
-- Para el primer rr_id del TEST B que tenga path1_count > 0
-- (Reemplaza el UUID con un rr_id del TEST B)
-- ══════════════════════════════════════════════════════════════
-- SELECT t.id, t.type, t.ticket_code, t.payment_status,
--        t.metadata->>'recharge_request_id' AS rr_en_meta
-- FROM transactions t
-- WHERE t.metadata->>'recharge_request_id' = 'PEGAR_UUID_AQUI'
--   AND t.is_deleted = false;

-- ══════════════════════════════════════════════════════════════
-- TEST D: Llamar al RPC y ver qué retorna
-- Si invoice_number es '—' para todo → el LATERAL no encuentra nada
-- ══════════════════════════════════════════════════════════════
SELECT
  student_name,
  concepto,
  reference_code,
  invoice_number,
  invoice_type
FROM get_payment_history('', 5, 0);

-- ══════════════════════════════════════════════════════════════
-- TEST E: ¿Hay boletas en la tabla invoices?
-- Si da 0 → nadie ha emitido boletas todavía → "Pendiente" es correcto
-- ══════════════════════════════════════════════════════════════
SELECT
  document_type_code,
  sunat_status,
  COUNT(*) AS cantidad
FROM invoices
GROUP BY document_type_code, sunat_status
ORDER BY cantidad DESC;

-- ══════════════════════════════════════════════════════════════
-- CÓMO LEER LOS RESULTADOS:
--
-- Caso 1: TEST A → con_ticket_code = 0
--   → El kiosco NUNCA guardó ticket codes. Solo habrá Comprobante
--     cuando se genere una boleta electrónica vía Nubefact.
--
-- Caso 2: TEST B → path1_count = 0 para todos Y tx_en_paid_ids = NULL
--   → Los debt_payment fueron aprobados por un flujo diferente que
--     NO vincula las transacciones. El LATERAL no encuentra nada.
--
-- Caso 3: TEST B → path1_ticket o path2_ticket tienen valor
--   → El enlace funciona pero algo falla en la función. Compartir resultado.
--
-- Caso 4: TEST E → cantidad > 0
--   → Hay boletas emitidas. El problema es el enlace invoice ↔ transaction.
-- ══════════════════════════════════════════════════════════════
