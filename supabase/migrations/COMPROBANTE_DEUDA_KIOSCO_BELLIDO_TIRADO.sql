-- =====================================================================
-- COMPROBANTE: Historial de compras de KIOSCO — Bellido Tirado
-- Para la administradora: mostrarle a la mamá que sus almuerzos están
-- pagados, pero estos son los consumos del kiosco (cafetería/POS).
-- Solo lectura — no modifica nada.
-- =====================================================================

-- ─── RESUMEN POR ALUMNO ──────────────────────────────────────────────
SELECT
  s.full_name                            AS "Alumno",
  s.balance                              AS "Saldo Actual (Kiosco)",
  COUNT(t.id)                            AS "Nº Compras Kiosco",
  SUM(ABS(t.amount))                     AS "Total Compras (S/)",
  -- Compras pagadas vs pendientes
  COUNT(CASE WHEN t.payment_status = 'paid'    THEN 1 END) AS "Pagadas",
  COUNT(CASE WHEN t.payment_status = 'pending' THEN 1 END) AS "Pendientes",
  SUM(CASE WHEN t.payment_status = 'pending' THEN ABS(t.amount) ELSE 0 END) AS "Deuda Pendiente (S/)"
FROM students s
LEFT JOIN transactions t
  ON  t.student_id = s.id
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status != 'cancelled'
  AND (t.metadata->>'lunch_order_id') IS NULL  -- SOLO kiosco, NO almuerzos
WHERE s.full_name ILIKE '%Bellido%Tirado%'
GROUP BY s.id, s.full_name, s.balance
ORDER BY s.full_name;


-- ─── DETALLE: MATEO BENJAMIN BELLIDO TIRADO ──────────────────────────
-- Todas las compras de kiosco (POS) — la suma debe dar ~188.50
SELECT
  t.created_at::date                     AS "Fecha",
  to_char(t.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS "Hora",
  t.description                          AS "Descripción",
  ABS(t.amount)                          AS "Monto (S/)",
  t.payment_status                       AS "Estado",
  t.payment_method                       AS "Método",
  t.ticket_code                          AS "Ticket",
  SUM(ABS(t.amount)) OVER (
    ORDER BY t.created_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )                                      AS "Acumulado (S/)"
FROM transactions t
WHERE t.student_id = '273edace-ce52-4b76-95cf-5f3492368ada'
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status != 'cancelled'
  AND (t.metadata->>'lunch_order_id') IS NULL  -- SOLO kiosco
ORDER BY t.created_at;


-- ─── DETALLE: PIERO ALESSANDRO BELLIDO TIRADO ────────────────────────
-- Todas las compras de kiosco (POS) — la suma debe dar ~160.00
SELECT
  t.created_at::date                     AS "Fecha",
  to_char(t.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS "Hora",
  t.description                          AS "Descripción",
  ABS(t.amount)                          AS "Monto (S/)",
  t.payment_status                       AS "Estado",
  t.payment_method                       AS "Método",
  t.ticket_code                          AS "Ticket",
  SUM(ABS(t.amount)) OVER (
    ORDER BY t.created_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )                                      AS "Acumulado (S/)"
FROM transactions t
WHERE t.student_id = 'bc6af3c3-398c-4f3f-864e-a219a74d494a'
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status != 'cancelled'
  AND (t.metadata->>'lunch_order_id') IS NULL  -- SOLO kiosco
ORDER BY t.created_at;


-- ─── VERIFICACIÓN: Almuerzos pagados (para mostrar que SÍ están ok) ─
SELECT
  s.full_name                            AS "Alumno",
  COUNT(t.id)                            AS "Nº Almuerzos",
  SUM(ABS(t.amount))                     AS "Total Almuerzos (S/)",
  COUNT(CASE WHEN t.payment_status = 'paid' THEN 1 END) AS "Pagados",
  COUNT(CASE WHEN t.payment_status = 'pending' THEN 1 END) AS "Pendientes"
FROM students s
LEFT JOIN transactions t
  ON  t.student_id = s.id
  AND t.type = 'purchase'
  AND t.is_deleted = false
  AND t.payment_status != 'cancelled'
  AND (t.metadata->>'lunch_order_id') IS NOT NULL  -- SOLO almuerzos
WHERE s.full_name ILIKE '%Bellido%Tirado%'
GROUP BY s.id, s.full_name
ORDER BY s.full_name;
