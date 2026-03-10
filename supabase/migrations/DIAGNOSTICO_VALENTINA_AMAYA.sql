-- =========================================================
-- DIAGNÓSTICO COMPLETO: Valentina Amaya Segura Castro
-- =========================================================

-- PASO 1: Ver datos actuales del alumno
SELECT
  s.id            AS student_id,
  s.full_name,
  s.balance       AS saldo_actual,
  s.free_account  AS cuenta_libre,
  sch.name        AS colegio
FROM students s
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.full_name ILIKE '%Valentina Amaya%';


-- PASO 2: Ver TODAS sus transacciones (recargas + compras) ordenadas por fecha
SELECT
  t.created_at            AS fecha,
  t.type                  AS tipo,
  t.amount                AS monto,
  t.balance_after         AS saldo_despues,
  t.payment_status        AS estado_pago,
  t.payment_method        AS metodo_pago,
  t.description           AS descripcion,
  t.ticket_code           AS ticket
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
WHERE s.full_name ILIKE '%Valentina Amaya%'
ORDER BY t.created_at ASC;


-- PASO 3: Ver las compras de ayer (03 de marzo 2026) específicamente
SELECT
  t.created_at            AS fecha_hora,
  ABS(t.amount)           AS monto_compra,
  t.payment_status        AS estado,
  t.payment_method        AS metodo,
  t.description           AS descripcion,
  t.balance_after         AS saldo_registrado_despues,
  t.ticket_code           AS ticket
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
WHERE s.full_name ILIKE '%Valentina Amaya%'
  AND t.type = 'purchase'
  AND t.created_at >= '2026-03-03 00:00:00+00'
  AND t.created_at <  '2026-03-05 00:00:00+00'
ORDER BY t.created_at ASC;
