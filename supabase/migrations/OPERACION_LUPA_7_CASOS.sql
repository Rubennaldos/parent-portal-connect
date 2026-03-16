-- ============================================================
-- OPERACIÓN LUPA — Corre CADA BLOQUE por separado en Supabase
-- Selecciona SOLO el query que quieres correr (hasta el ;)
-- ============================================================
-- IDs CONFIRMADOS:
-- a68f76fb  → Alessandra Nicole Diaz Ridia    saldo: 8.50
-- 41e0a7eb  → Guadalupe Diaz                  saldo: 6.00
-- d2193d52  → Ivo Melgar zignago              saldo: -74.00 ⚠️
-- 74ec0dc7  → Joyce Valentina Cayo Dueñas     saldo: 87.50
-- fb764d77  → Mathias Mendieta Zeidan         saldo: 320.00
-- 616e5c41  → Stephania Julieth Escobar       saldo: 320.00
-- 6789ee22  → Valia Rebatta Matencio          saldo: 0.00
-- ============================================================

-- ============================================================
-- QUERY 1: Confirmar IDs de los 7 alumnos (YA CORRIDO ✓)
-- ============================================================
SELECT id, full_name, balance, school_id
FROM students
WHERE full_name ILIKE '%Valia Rebatta%'
   OR full_name ILIKE '%Alessandra Nicole Diaz Ridia%'
   OR full_name ILIKE '%Ivo Melgar%'
   OR full_name ILIKE '%Guadalupe Diaz%'
   OR full_name ILIKE '%Joyce Valentina Cayo%'
   OR full_name ILIKE '%Mathias Mendieta Zeidan%'
   OR full_name ILIKE '%Stephania Julieth Escobar%'
ORDER BY full_name;

-- ============================================================
-- QUERY 2: Historial de vouchers / recharge_requests
-- ============================================================
SELECT
  s.full_name                           AS alumno,
  rr.id                                 AS voucher_id,
  rr.request_type                       AS tipo,
  rr.amount                             AS monto,
  rr.status                             AS estado,
  rr.reference_code                     AS codigo_operacion,
  rr.created_at::date                   AS fecha_envio,
  rr.approved_at::date                  AS fecha_aprobacion,
  rr.rejection_reason                   AS motivo_rechazo,
  rr.notes                              AS notas
FROM recharge_requests rr
JOIN students s ON s.id = rr.student_id
WHERE s.full_name ILIKE '%Valia Rebatta%'
   OR s.full_name ILIKE '%Alessandra Nicole Diaz Ridia%'
   OR s.full_name ILIKE '%Ivo Melgar%'
   OR s.full_name ILIKE '%Guadalupe Diaz%'
   OR s.full_name ILIKE '%Joyce Valentina Cayo%'
   OR s.full_name ILIKE '%Mathias Mendieta Zeidan%'
   OR s.full_name ILIKE '%Stephania Julieth Escobar%'
ORDER BY s.full_name, rr.created_at;

-- ============================================================
-- QUERY 3: Historial de transacciones de saldo
-- ============================================================
SELECT
  s.full_name                                        AS alumno,
  t.ticket_code,
  t.type                                             AS tipo,
  t.amount,
  t.payment_status,
  t.is_deleted,
  CASE
    WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN 'ALMUERZO'
    ELSE 'KIOSCO/RECARGA'
  END                                                AS origen,
  t.description,
  t.created_at::date                                 AS fecha
FROM transactions t
JOIN students s ON s.id = t.student_id
WHERE (
  s.full_name ILIKE '%Valia Rebatta%'
   OR s.full_name ILIKE '%Alessandra Nicole Diaz Ridia%'
   OR s.full_name ILIKE '%Ivo Melgar%'
   OR s.full_name ILIKE '%Guadalupe Diaz%'
   OR s.full_name ILIKE '%Joyce Valentina Cayo%'
   OR s.full_name ILIKE '%Mathias Mendieta Zeidan%'
   OR s.full_name ILIKE '%Stephania Julieth Escobar%'
)
ORDER BY s.full_name, t.created_at;

-- ============================================================
-- QUERY 4: CRUCE — Recarga aprobada vs Transacción existente
-- Si sale "RECARGA APROBADA SIN TRANSACCIÓN" = dinero perdido
-- ============================================================
SELECT
  s.full_name                                         AS alumno,
  rr.amount                                           AS monto_voucher,
  rr.status                                           AS estado_voucher,
  rr.created_at::date                                 AS fecha_voucher,
  t.id                                                AS transaction_id,
  t.amount                                            AS monto_transaccion,
  t.created_at::date                                  AS fecha_transaccion,
  CASE
    WHEN t.id IS NULL AND rr.status = 'approved'
      THEN 'RECARGA APROBADA SIN TRANSACCION'
    WHEN t.id IS NOT NULL AND rr.status = 'approved'
      THEN 'OK'
    WHEN rr.status = 'rejected'
      THEN 'Rechazado'
    WHEN rr.status = 'pending'
      THEN 'Pendiente'
    ELSE 'Revisar'
  END                                                 AS diagnostico
FROM recharge_requests rr
JOIN students s ON s.id = rr.student_id
LEFT JOIN transactions t
  ON  t.student_id = rr.student_id
  AND t.type = 'recharge'
  AND ABS(t.amount - rr.amount) < 0.01
  AND t.created_at BETWEEN rr.created_at - INTERVAL '10 minutes'
                       AND rr.created_at + INTERVAL '24 hours'
  AND t.is_deleted = false
WHERE rr.request_type = 'recharge'
  AND (
    s.full_name ILIKE '%Valia Rebatta%'
    OR s.full_name ILIKE '%Alessandra Nicole Diaz Ridia%'
    OR s.full_name ILIKE '%Ivo Melgar%'
    OR s.full_name ILIKE '%Guadalupe Diaz%'
    OR s.full_name ILIKE '%Joyce Valentina Cayo%'
    OR s.full_name ILIKE '%Mathias Mendieta Zeidan%'
    OR s.full_name ILIKE '%Stephania Julieth Escobar%'
  )
ORDER BY s.full_name, rr.created_at;

-- ============================================================
-- QUERY 5: RESUMEN EJECUTIVO — Total aprobado vs en transacciones
-- ============================================================
SELECT
  s.full_name                                           AS alumno,
  s.balance                                             AS saldo_actual_bd,
  COALESCE(
    (SELECT SUM(rr.amount) FROM recharge_requests rr
     WHERE rr.student_id = s.id AND rr.request_type = 'recharge'
     AND rr.status = 'approved'), 0)                    AS total_recargas_aprobadas,
  COALESCE(
    (SELECT SUM(t.amount) FROM transactions t
     WHERE t.student_id = s.id AND t.type = 'recharge'
     AND t.is_deleted = false), 0)                      AS total_recargas_en_tx,
  COALESCE(
    (SELECT SUM(rr.amount) FROM recharge_requests rr
     WHERE rr.student_id = s.id AND rr.request_type = 'recharge'
     AND rr.status = 'approved'), 0)
  - COALESCE(
    (SELECT SUM(t.amount) FROM transactions t
     WHERE t.student_id = s.id AND t.type = 'recharge'
     AND t.is_deleted = false), 0)                      AS diferencia_aprobado_vs_tx
FROM students s
WHERE s.full_name ILIKE '%Valia Rebatta%'
   OR s.full_name ILIKE '%Alessandra Nicole Diaz Ridia%'
   OR s.full_name ILIKE '%Ivo Melgar%'
   OR s.full_name ILIKE '%Guadalupe Diaz%'
   OR s.full_name ILIKE '%Joyce Valentina Cayo%'
   OR s.full_name ILIKE '%Mathias Mendieta Zeidan%'
   OR s.full_name ILIKE '%Stephania Julieth Escobar%'
ORDER BY s.full_name;

-- ============================================================
-- QUERY 6 (RÁPIDO): Saldo contable real — lo que dicen las transacciones
-- Compara contra students.balance para detectar fantasmas
-- ============================================================
SELECT
  s.full_name                                              AS alumno,
  s.balance                                                AS saldo_en_bd,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
                                                           AS total_recargas_tx,
  COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
                                                           AS total_compras_tx,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
                                                           AS saldo_calculado_tx,
  s.balance - (
    COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
  )                                                        AS diferencia_fantasma
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id
  AND t.metadata->>'lunch_order_id' IS NULL
WHERE s.id IN (
  'a68f76fb-fe26-42d2-8e23-039946bc633d',
  '41e0a7eb-cece-4d9e-983d-e5432d5d52b9',
  'd2193d52-d219-4f86-8b7c-7bc545192094',
  '74ec0dc7-e782-46ff-831e-ba11b9a09771',
  'fb764d77-5af9-4b8d-9661-e8a6b527c565',
  '616e5c41-3c0f-4a2d-8883-1a5670f23052',
  '6789ee22-3a37-4e8b-8ee8-c4d56cf46d6e'
)
GROUP BY s.id, s.full_name, s.balance
ORDER BY s.full_name;

-- ============================================================
-- QUERY 7 (RÁPIDO): Ver TODAS las transacciones de Ivo Melgar (-74)
-- El más urgente — saldo negativo de -74 soles
-- ============================================================
SELECT
  t.ticket_code,
  t.type                                                   AS tipo,
  t.amount,
  t.payment_status,
  t.is_deleted,
  CASE
    WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN 'ALMUERZO'
    ELSE 'KIOSCO/RECARGA'
  END                                                      AS origen,
  t.description,
  t.created_at AT TIME ZONE 'America/Lima'                 AS fecha_lima
FROM transactions t
WHERE t.student_id = 'd2193d52-d219-4f86-8b7c-7bc545192094'
ORDER BY t.created_at DESC;

-- ============================================================
-- QUERY 8 (RÁPIDO): Ver vouchers de Ivo Melgar
-- ============================================================
SELECT
  rr.id                                                    AS voucher_id,
  rr.request_type                                          AS tipo,
  rr.amount,
  rr.status,
  rr.reference_code,
  rr.created_at AT TIME ZONE 'America/Lima'                AS fecha_lima,
  rr.approved_at AT TIME ZONE 'America/Lima'               AS aprobado_lima,
  rr.rejection_reason,
  rr.notes
FROM recharge_requests rr
WHERE rr.student_id = 'd2193d52-d219-4f86-8b7c-7bc545192094'
ORDER BY rr.created_at DESC;
