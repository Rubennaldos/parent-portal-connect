-- ================================================================
-- RASTREO DE RECARGAS LEGÍTIMAS + RECUPERAR "CON RECARGAS"
-- Pregunta: ¿Quiénes de los 97 alumnos hicieron recargas reales?
-- Bonus: recuperar quiénes eran "Con Recargas" antes del mantenimiento
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- PARTE 1: HISTORIAL DE RECARGAS APROBADAS — el rastro del botón
-- ════════════════════════════════════════════════════════════════

-- 1-A) Resumen global: cuántos padres usaron el flujo de recargas
SELECT
  COUNT(DISTINCT student_id)                                       AS alumnos_con_recarga_aprobada,
  COUNT(*)                                                         AS total_recargas_aprobadas,
  ROUND(SUM(amount)::numeric, 2)                                   AS monto_total_aprobado,
  MIN(created_at)                                                  AS primera_recarga,
  MAX(created_at)                                                  AS ultima_recarga
FROM recharge_requests
WHERE status = 'approved'
  AND request_type = 'recharge';

-- 1-B) Lista de alumnos con recargas aprobadas (el rastro del voucher)
SELECT
  s.full_name         AS alumno,
  sch.name            AS sede,
  s.balance           AS saldo_actual,
  COUNT(rr.id)        AS veces_recargado,
  ROUND(SUM(rr.amount)::numeric, 2)  AS total_ingresado_por_recargas,
  MAX(rr.approved_at) AS ultima_aprobacion
FROM recharge_requests rr
JOIN students s   ON s.id   = rr.student_id
JOIN schools  sch ON sch.id = s.school_id
WHERE rr.status = 'approved'
  AND rr.request_type = 'recharge'
GROUP BY s.full_name, sch.name, s.balance
ORDER BY total_ingresado_por_recargas DESC;


-- ════════════════════════════════════════════════════════════════
-- PARTE 2: CRUCE — de los 97 con saldo fantasma,
--          ¿cuántos tienen recargas legítimas en recharge_requests?
-- ════════════════════════════════════════════════════════════════

WITH fantasma AS (
  SELECT
    s.id,
    s.full_name,
    s.balance           AS balance_actual,
    s.created_at,
    sch.name            AS sede,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount ELSE 0
      END
    ), 0)               AS balance_transacciones
  FROM students s
  LEFT JOIN schools sch ON sch.id = s.school_id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance, s.created_at, sch.name
  HAVING ABS(s.balance - COALESCE(SUM(
    CASE
      WHEN t.is_deleted = false AND t.payment_status != 'cancelled'
       AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
      THEN t.amount ELSE 0 END
  ), 0)) > 0.01
),
recargas AS (
  SELECT
    student_id,
    COUNT(*)                      AS veces,
    ROUND(SUM(amount)::numeric,2) AS total_recargado
  FROM recharge_requests
  WHERE status = 'approved'
    AND request_type = 'recharge'
  GROUP BY student_id
)
SELECT
  f.full_name                                                   AS alumno,
  f.sede,
  ROUND((f.balance_actual - f.balance_transacciones)::numeric,2) AS saldo_sin_respaldo,
  COALESCE(r.total_recargado, 0)                                AS recargado_por_voucher,
  ROUND((f.balance_actual - f.balance_transacciones - COALESCE(r.total_recargado,0))::numeric,2)
                                                                AS diferencia_aun_inexplicada,
  CASE
    WHEN r.student_id IS NOT NULL
      AND ABS(f.balance_actual - f.balance_transacciones - r.total_recargado) < 0.01
    THEN '✅ EXPLICADO — todo por vouchers aprobados'
    WHEN r.student_id IS NOT NULL
    THEN '⚠️ PARCIAL — hay vouchers pero no alcanzan a explicar todo'
    ELSE '❓ SIN RASTRO — sin recharge_requests aprobados'
  END AS diagnostico
FROM fantasma f
LEFT JOIN recargas r ON r.student_id = f.id
ORDER BY saldo_sin_respaldo DESC;


-- ════════════════════════════════════════════════════════════════
-- PARTE 3: RECUPERAR QUIÉNES ERAN "CON RECARGAS"
-- (para cuando se reactive el sistema)
-- La respuesta está en recharge_requests: si un alumno tuvo
-- al menos 1 recarga aprobada, era "Con Recargas".
-- ════════════════════════════════════════════════════════════════

-- 3-A) Alumnos que DEBERÍAN volver a "Con Recargas" al reactivar
--      (tuvieron al menos 1 recarga aprobada en el pasado)
SELECT
  s.id            AS student_id,
  s.full_name     AS alumno,
  sch.name        AS sede,
  s.balance       AS saldo_actual,
  s.free_account  AS estado_actual,   -- true = cuenta libre (post-mantenimiento)
  COUNT(rr.id)    AS recargas_historicas,
  ROUND(SUM(rr.amount)::numeric, 2) AS total_recargado_historico
FROM students s
JOIN schools sch ON sch.id = s.school_id
JOIN recharge_requests rr ON rr.student_id = s.id
  AND rr.status = 'approved'
  AND rr.request_type = 'recharge'
WHERE s.is_active = true
GROUP BY s.id, s.full_name, sch.name, s.balance, s.free_account
ORDER BY total_recargado_historico DESC;

-- 3-B) Resumen: cuántos alumnos recuperables como "Con Recargas"
SELECT
  COUNT(DISTINCT rr.student_id)         AS alumnos_que_recargaron_antes,
  ROUND(SUM(rr.amount)::numeric, 2)     AS monto_total_en_sistema
FROM recharge_requests rr
WHERE rr.status = 'approved'
  AND rr.request_type = 'recharge';


-- ════════════════════════════════════════════════════════════════
-- PARTE 4: SCRIPT LISTO PARA REACTIVAR (NO EJECUTAR AÚN)
-- Cuando llegue el momento de levantar el mantenimiento:
-- Poner en "Con Recargas" solo a quienes sí recargaron antes.
-- ════════════════════════════════════════════════════════════════

-- ⚠️ DESCOMENTAR Y EJECUTAR SOLO CUANDO SE LEVANTE EL MANTENIMIENTO

/*
UPDATE students s
SET free_account = false
WHERE s.id IN (
  SELECT DISTINCT student_id
  FROM recharge_requests
  WHERE status = 'approved'
    AND request_type = 'recharge'
)
AND s.is_active = true;

SELECT '✅ Alumnos con historial de recargas vueltos a "Con Recargas"' AS resultado;
*/
