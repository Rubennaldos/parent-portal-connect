-- =========================================================
-- DIAGNÓSTICO: Padres que recargaron pero el saldo
--              NO se descontó después de compras
-- =========================================================
-- Fecha: 2026-03-04
-- Ejecutar en: Supabase → SQL Editor
-- =========================================================


-- ─────────────────────────────────────────────────────────
-- PASO 1: Ver TODAS las recargas aprobadas de los últimos
--         60 días y cuánto saldo tiene el alumno ahora
-- ─────────────────────────────────────────────────────────
SELECT
  s.full_name          AS alumno,
  sch.name             AS colegio,
  s.balance            AS saldo_actual,
  s.free_account       AS es_cuenta_libre,
  -- Total recargado (aprobado)
  SUM(r.amount)        AS total_recargado,
  -- Número de recargas
  COUNT(r.id)          AS num_recargas,
  -- Fecha última recarga
  MAX(r.approved_at)   AS ultima_recarga

FROM recharge_requests r
INNER JOIN students s   ON r.student_id = s.id
LEFT JOIN  schools  sch ON s.school_id  = sch.id
WHERE r.status       = 'approved'
  AND r.request_type = 'recharge'
  AND r.approved_at >= NOW() - INTERVAL '60 days'
GROUP BY s.id, s.full_name, s.balance, s.free_account, sch.name
ORDER BY total_recargado DESC;


-- ─────────────────────────────────────────────────────────
-- PASO 2: Para cada alumno que recargó → ver cuánto
--         consumió y si coincide con el saldo actual
-- ─────────────────────────────────────────────────────────
WITH recargas AS (
  SELECT
    r.student_id,
    SUM(r.amount) AS total_recargado
  FROM recharge_requests r
  WHERE r.status       = 'approved'
    AND r.request_type = 'recharge'
    AND r.approved_at  >= NOW() - INTERVAL '60 days'
  GROUP BY r.student_id
),
compras_pagadas AS (
  -- Compras que SÍ descontaron del saldo
  SELECT
    t.student_id,
    SUM(ABS(t.amount)) AS total_descontado
  FROM transactions t
  WHERE t.type           = 'purchase'
    AND t.payment_status = 'paid'
    AND t.payment_method = 'saldo'   -- Solo las que pagaron con saldo
    AND t.created_at     >= NOW() - INTERVAL '60 days'
  GROUP BY t.student_id
),
compras_deuda AS (
  -- Compras que NO descontaron (quedaron como deuda)
  SELECT
    t.student_id,
    COUNT(t.id)        AS num_compras_deuda,
    SUM(ABS(t.amount)) AS total_deuda
  FROM transactions t
  WHERE t.type           = 'purchase'
    AND t.payment_status = 'pending'
    AND t.created_at     >= NOW() - INTERVAL '60 days'
    AND NOT (t.metadata::jsonb ? 'lunch_order_id')  -- Excluir almuerzos
  GROUP BY t.student_id
)
SELECT
  s.full_name                                      AS alumno,
  sch.name                                         AS colegio,
  s.free_account                                   AS cuenta_libre,
  s.balance                                        AS saldo_actual,
  COALESCE(r.total_recargado,    0)                AS total_recargado,
  COALESCE(cp.total_descontado,  0)                AS total_descontado_saldo,
  COALESCE(cd.num_compras_deuda, 0)                AS compras_en_deuda,
  COALESCE(cd.total_deuda,       0)                AS monto_en_deuda,
  -- ¿El saldo actual coincide con lo esperado?
  -- Esperado = recargado - descontado
  (COALESCE(r.total_recargado, 0) - COALESCE(cp.total_descontado, 0)) AS saldo_esperado,
  -- Diferencia: si es > 0, hay saldo que NO se descontó
  (COALESCE(r.total_recargado, 0) - COALESCE(cp.total_descontado, 0) - s.balance) AS diferencia_saldo,
  CASE
    WHEN COALESCE(cd.num_compras_deuda, 0) > 0
         AND COALESCE(r.total_recargado, 0) > 0
    THEN '🚨 PROBLEMA: Recargó pero compras quedaron como deuda (no se descontó)'
    WHEN COALESCE(r.total_recargado, 0) > 0
         AND (COALESCE(r.total_recargado, 0) - COALESCE(cp.total_descontado, 0) - s.balance) > 0.10
    THEN '⚠️  Saldo no cuadra (puede haber compras sin descontar)'
    WHEN COALESCE(r.total_recargado, 0) > 0
    THEN '✅ OK: Saldo cuadra correctamente'
    ELSE '— Sin recargas recientes'
  END AS diagnostico

FROM students s
INNER JOIN recargas r         ON r.student_id = s.id
LEFT JOIN  compras_pagadas cp ON cp.student_id = s.id
LEFT JOIN  compras_deuda   cd ON cd.student_id = s.id
LEFT JOIN  schools       sch  ON s.school_id   = sch.id
ORDER BY
  -- Mostrar primero los problemáticos
  CASE
    WHEN COALESCE(cd.num_compras_deuda,0) > 0 AND COALESCE(r.total_recargado,0) > 0 THEN 1
    WHEN (COALESCE(r.total_recargado,0) - COALESCE(cp.total_descontado,0) - s.balance) > 0.10 THEN 2
    ELSE 3
  END,
  s.full_name;


-- ─────────────────────────────────────────────────────────
-- PASO 3: Detalle de compras que quedaron como DEUDA
--         pese a que el alumno tenía saldo de recarga
-- ─────────────────────────────────────────────────────────
SELECT
  s.full_name                  AS alumno,
  sch.name                     AS colegio,
  s.balance                    AS saldo_actual_alumno,
  s.free_account               AS cuenta_libre,
  t.created_at                 AS fecha_compra,
  ABS(t.amount)                AS monto_compra,
  t.payment_status             AS estado_pago,
  t.description                AS descripcion,
  t.ticket_code                AS ticket,
  -- ¿Tenía saldo al momento de la compra?
  COALESCE(
    (SELECT SUM(r2.amount)
     FROM recharge_requests r2
     WHERE r2.student_id = s.id
       AND r2.status = 'approved'
       AND r2.request_type = 'recharge'
       AND r2.approved_at < t.created_at),
    0
  ) - COALESCE(
    (SELECT SUM(ABS(t2.amount))
     FROM transactions t2
     WHERE t2.student_id      = s.id
       AND t2.type            = 'purchase'
       AND t2.payment_status  = 'paid'
       AND t2.payment_method  = 'saldo'
       AND t2.created_at      < t.created_at),
    0
  ) AS saldo_estimado_en_ese_momento

FROM transactions t
INNER JOIN students s   ON t.student_id = s.id
LEFT JOIN  schools  sch ON s.school_id  = sch.id
-- Solo alumnos que tienen recargas aprobadas en los últimos 60 días
WHERE t.student_id IN (
  SELECT DISTINCT student_id
  FROM recharge_requests
  WHERE status       = 'approved'
    AND request_type = 'recharge'
    AND approved_at  >= NOW() - INTERVAL '60 days'
)
AND t.type           = 'purchase'
AND t.payment_status = 'pending'      -- Quedó como deuda
AND t.created_at     >= NOW() - INTERVAL '60 days'
AND NOT (t.metadata::jsonb ? 'lunch_order_id')  -- Solo kiosco
ORDER BY t.created_at DESC;


-- ─────────────────────────────────────────────────────────
-- PASO 4: Resumen ejecutivo — ¿Cuántos alumnos afectados?
-- ─────────────────────────────────────────────────────────
SELECT
  COUNT(DISTINCT t.student_id) AS alumnos_afectados,
  COUNT(t.id)                  AS total_compras_sin_descontar,
  SUM(ABS(t.amount))           AS monto_total_sin_descontar_soles

FROM transactions t
INNER JOIN students s ON t.student_id = s.id
WHERE t.student_id IN (
  SELECT DISTINCT student_id
  FROM recharge_requests
  WHERE status       = 'approved'
    AND request_type = 'recharge'
    AND approved_at  >= NOW() - INTERVAL '60 days'
)
AND t.type           = 'purchase'
AND t.payment_status = 'pending'
AND t.created_at     >= NOW() - INTERVAL '60 days'
AND NOT (t.metadata::jsonb ? 'lunch_order_id');
