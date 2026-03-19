-- ============================================================
-- INVESTIGAR DUPLICADO: Renzo Guardia — código 69579347
-- ============================================================

-- ── PASO 1: Ver las dos recharge_requests duplicadas ─────────
SELECT
  rr.id             AS recharge_request_id,
  rr.status,
  rr.amount,
  rr.reference_code,
  rr.request_type,
  rr.created_at,
  rr.approved_at,
  rr.approved_by,
  rr.transaction_id,
  rr.voucher_url,
  rr.paid_transaction_ids
FROM recharge_requests rr
WHERE rr.reference_code = '69579347'
  AND rr.status != 'rejected'
ORDER BY rr.created_at;


-- ── PASO 2: Ver las transacciones que se generaron ───────────
-- Busca todas las transacciones vinculadas al alumno Renzo
-- alrededor de las fechas del duplicado
SELECT
  t.id              AS transaction_id,
  t.amount,
  t.payment_status,
  t.type,
  t.created_at,
  t.metadata
FROM transactions t
WHERE t.student_id = (
  SELECT id FROM students
  WHERE LOWER(full_name) LIKE '%renzo%guardia%'
  LIMIT 1
)
AND t.created_at BETWEEN '2026-02-27' AND '2026-03-01'
ORDER BY t.created_at;


-- ── PASO 3: Ver el saldo actual del alumno ───────────────────
SELECT
  s.id,
  s.full_name,
  s.balance,
  s.free_account,
  s.kiosk_disabled
FROM students s
WHERE LOWER(s.full_name) LIKE '%renzo%guardia%';
