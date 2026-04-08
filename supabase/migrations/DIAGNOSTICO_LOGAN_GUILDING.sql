-- ══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO COMPLETO: Logan Guilding Tagami
-- student_id: 56d65e6e-ff3c-4845-9d1e-26e8e34bda23
-- saldo: -30.50  |  free_account: true  |  sede: Nordic
-- ══════════════════════════════════════════════════════════════════════════

-- 1. HISTORIAL COMPLETO DE TRANSACCIONES
SELECT
  t.id,
  t.ticket_code,
  t.type,
  t.amount,
  t.payment_status,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_lima,
  t.description,
  t.is_deleted,
  t.metadata->>'source' AS source,
  EXISTS (
    SELECT 1 FROM sales s
    WHERE s.transaction_id = t.id::text   -- cast uuid→text
  ) AS tiene_registro_en_sales
FROM transactions t
WHERE t.student_id = '56d65e6e-ff3c-4845-9d1e-26e8e34bda23'
ORDER BY t.created_at DESC
LIMIT 60;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. ÍTEMS DE VENTAS (tabla sales)
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  s.transaction_id,
  t.ticket_code,
  t.amount,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha,
  s.items
FROM sales s
JOIN transactions t ON t.id::text = s.transaction_id
WHERE t.student_id = '56d65e6e-ff3c-4845-9d1e-26e8e34bda23'
ORDER BY t.created_at DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. VOUCHERS / PAGOS ENVIADOS POR EL PADRE ← LA CLAVE
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  rr.id,
  rr.request_type,
  rr.amount,
  rr.status,
  rr.created_at  AT TIME ZONE 'America/Lima' AS enviado_en,
  rr.reviewed_at AT TIME ZONE 'America/Lima' AS revisado_en,
  rr.rejection_reason,
  rr.paid_transaction_ids
FROM recharge_requests rr
WHERE rr.student_id = '56d65e6e-ff3c-4845-9d1e-26e8e34bda23'
ORDER BY rr.created_at DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. RECARGAS Y AJUSTES APLICADOS AL SALDO
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  t.ticket_code,
  t.type,
  t.amount,
  t.payment_status,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha,
  t.description
FROM transactions t
WHERE t.student_id = '56d65e6e-ff3c-4845-9d1e-26e8e34bda23'
  AND t.type IN ('recharge', 'adjustment', 'refund', 'debt_payment')
ORDER BY t.created_at DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. DEUDA OFICIAL (vista unificada)
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  deuda_id,
  monto,
  descripcion,
  fuente,
  fecha AT TIME ZONE 'America/Lima' AS fecha,
  ticket_code
FROM view_student_debts
WHERE student_id = '56d65e6e-ff3c-4845-9d1e-26e8e34bda23';
