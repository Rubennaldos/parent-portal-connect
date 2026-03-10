-- =========================================================
-- DIAGNÓSTICO: Padres que RECARGARON PRIMERO y luego
--              su hijo CONSUMIÓ pero NO SE DESCONTÓ el saldo
-- =========================================================
-- Este es el caso MÁS GRAVE:
--   1. Recarga aprobada → saldo subió
--   2. Hijo compra en kiosco DESPUÉS de la recarga
--   3. El saldo NO bajó (compra quedó como deuda pendiente)
-- =========================================================


-- ══════════════════════════════════════════════════════════
-- PASO 1: Encontrar todos los casos problemáticos
--         (compra DESPUÉS de la recarga, pero quedó pending)
-- ══════════════════════════════════════════════════════════
SELECT
  s.full_name                          AS alumno,
  sch.name                             AS colegio,
  s.balance                            AS saldo_actual,
  s.free_account                       AS cuenta_libre,

  -- Datos de la recarga
  r.approved_at                        AS fecha_recarga_aprobada,
  r.amount                             AS monto_recargado,

  -- Datos de la compra (que debió descontarse)
  t.ticket_code                        AS ticket_compra,
  t.created_at                         AS fecha_compra,
  ABS(t.amount)                        AS monto_compra,
  t.payment_status                     AS estado_pago,
  t.description                        AS descripcion,

  -- Diferencia de tiempo
  EXTRACT(EPOCH FROM (t.created_at - r.approved_at)) / 3600
                                       AS horas_despues_de_recarga

FROM transactions t
INNER JOIN students s    ON t.student_id  = s.id
LEFT  JOIN schools  sch  ON s.school_id   = sch.id
-- Buscar la recarga más reciente ANTES de esta compra
INNER JOIN LATERAL (
  SELECT rr.approved_at, rr.amount
  FROM recharge_requests rr
  WHERE rr.student_id    = t.student_id
    AND rr.status        = 'approved'
    AND rr.request_type  = 'recharge'
    AND rr.approved_at   < t.created_at   -- ← Recarga ANTES de la compra
  ORDER BY rr.approved_at DESC
  LIMIT 1
) r ON TRUE

WHERE t.type           = 'purchase'
  AND t.payment_status = 'pending'          -- ← No se descontó
  AND t.student_id     IS NOT NULL
  AND NOT (t.metadata::jsonb ? 'lunch_order_id')  -- Solo kiosco
  -- La compra fue DESPUÉS de la recarga (no antes)
  AND t.created_at > r.approved_at

ORDER BY s.full_name, t.created_at;


-- ══════════════════════════════════════════════════════════
-- PASO 2: Resumen — ¿cuántos alumnos y cuánto dinero?
-- ══════════════════════════════════════════════════════════
SELECT
  COUNT(DISTINCT t.student_id)  AS alumnos_afectados,
  COUNT(t.id)                   AS compras_sin_descontar,
  SUM(ABS(t.amount))            AS total_soles_sin_descontar

FROM transactions t
INNER JOIN students s ON t.student_id = s.id
INNER JOIN LATERAL (
  SELECT rr.approved_at
  FROM recharge_requests rr
  WHERE rr.student_id   = t.student_id
    AND rr.status       = 'approved'
    AND rr.request_type = 'recharge'
    AND rr.approved_at  < t.created_at
  ORDER BY rr.approved_at DESC
  LIMIT 1
) r ON TRUE

WHERE t.type           = 'purchase'
  AND t.payment_status = 'pending'
  AND t.student_id     IS NOT NULL
  AND NOT (t.metadata::jsonb ? 'lunch_order_id')
  AND t.created_at > r.approved_at;
