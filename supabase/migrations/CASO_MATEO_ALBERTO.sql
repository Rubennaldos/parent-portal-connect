-- ============================================================
-- CASO MATEO ALBERTO — Diagnóstico de bloqueo de almuerzo
-- Corre CADA BLOQUE por separado en Supabase
-- ============================================================

-- ============================================================
-- PASO 0: Confirmar ID y saldo actual de Mateo
-- ============================================================
SELECT
  id,
  full_name,
  balance                                  AS saldo_kiosco,
  free_account,
  kiosk_disabled,
  school_id
FROM students
WHERE full_name ILIKE '%Mateo Alberto%'
ORDER BY full_name;

-- ============================================================
-- PASO 1: ¿Tiene deudas REALES de almuerzo pendientes?
-- Si hay filas aquí → ESO es lo que bloquea el pedido nuevo
-- Si no hay filas → el bloqueo es falso (bug visual o saldo kiosco)
-- ============================================================
SELECT
  t.id                                     AS transaction_id,
  t.ticket_code,
  t.amount,
  t.payment_status,
  t.metadata->>'lunch_order_id'            AS lunch_order_id,
  lo.status                                AS estado_orden,
  t.description,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_lima
FROM transactions t
JOIN students s ON s.id = t.student_id
LEFT JOIN lunch_orders lo
  ON lo.id = (t.metadata->>'lunch_order_id')::uuid
WHERE s.full_name ILIKE '%Mateo Alberto%'
  AND t.payment_status = 'pending'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND t.is_deleted = false
ORDER BY t.created_at;

-- ============================================================
-- PASO 2: ¿Hay un voucher de S/ 43.50 subido recientemente?
-- Si está 'pending' → el admin aún no lo ha aprobado
-- Si está 'approved' → debería haber levantado el bloqueo
-- ============================================================
SELECT
  rr.id                                    AS voucher_id,
  rr.request_type                          AS tipo,
  rr.amount,
  rr.status,
  rr.reference_code,
  rr.rejection_reason,
  rr.notes,
  rr.created_at AT TIME ZONE 'America/Lima' AS enviado_lima,
  rr.approved_at AT TIME ZONE 'America/Lima' AS aprobado_lima
FROM recharge_requests rr
JOIN students s ON s.id = rr.student_id
WHERE s.full_name ILIKE '%Mateo Alberto%'
ORDER BY rr.created_at DESC;

-- ============================================================
-- PASO 3: ¿El saldo de kiosco es exactamente -14.50?
-- S/ 14.50 = costo de 1 almuerzo → posible rastro del bug del trigger
-- Este query muestra TODAS las transacciones para entender el origen
-- ============================================================
SELECT
  t.ticket_code,
  t.type                                   AS tipo,
  t.amount,
  t.payment_status,
  CASE
    WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN 'ALMUERZO ⚠️'
    ELSE 'KIOSCO/RECARGA'
  END                                      AS origen,
  t.description,
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_lima
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE s.full_name ILIKE '%Mateo Alberto%'
  AND t.is_deleted = false
ORDER BY t.created_at DESC;
