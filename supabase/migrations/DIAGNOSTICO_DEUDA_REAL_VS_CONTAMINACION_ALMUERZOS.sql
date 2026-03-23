-- ================================================================
-- DIAGNÓSTICO: ¿La deuda de -S/17,410 es real o está inflada
-- por el trigger viejo que descontaba almuerzos del balance?
--
-- El trigger FIX_TRIGGER_Y_BALANCES_ALMUERZOS debía corregir esto,
-- pero puede no haberse aplicado a todos los alumnos.
--
-- REGLA: students.balance SOLO debe reflejar kiosco (POS) y recargas.
-- NUNCA pagos de almuerzo (esos tienen lunch_order_id en metadata).
-- ================================================================

-- 1) BALANCE CORRECTO vs BALANCE ACTUAL para alumnos con saldo negativo
--    Si balance_correcto > balance_actual → hay contaminación de almuerzos
WITH balance_correcto AS (
  SELECT
    s.id,
    s.full_name,
    s.balance                                                  AS balance_actual,
    sch.name                                                   AS sede,
    -- Solo transacciones de kiosco/recargas (SIN almuerzos)
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount
        ELSE 0
      END
    ), 0)                                                      AS balance_solo_kiosco,
    -- Lo que se descontó por almuerzos (no debería tocar balance)
    COALESCE(SUM(
      CASE
        WHEN (t.metadata->>'lunch_order_id') IS NOT NULL
         AND t.is_deleted = false
        THEN t.amount
        ELSE 0
      END
    ), 0)                                                      AS descontado_por_almuerzos
  FROM students s
  LEFT JOIN schools sch ON sch.id = s.school_id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
    AND s.balance < 0   -- solo los que aparecen con deuda
  GROUP BY s.id, s.full_name, s.balance, sch.name
)
SELECT
  full_name                                                    AS alumno,
  sede,
  ROUND(balance_actual::numeric, 2)                           AS "Balance BD (con posible contaminación)",
  ROUND(balance_solo_kiosco::numeric, 2)                      AS "Balance correcto (solo kiosco)",
  ROUND(descontado_por_almuerzos::numeric, 2)                 AS "Descontado por almuerzos (no debería)",
  ROUND((balance_actual - balance_solo_kiosco)::numeric, 2)   AS "Diferencia (contaminación)",
  CASE
    WHEN ABS(balance_actual - balance_solo_kiosco) < 0.01
    THEN '✅ OK — deuda real de kiosco'
    WHEN balance_actual < balance_solo_kiosco
    THEN '🚨 CONTAMINADO — trigger viejo descontó almuerzos'
    ELSE '⚠️ Revisar'
  END                                                         AS diagnostico
FROM balance_correcto
ORDER BY (balance_actual - balance_solo_kiosco) ASC
LIMIT 50;


-- 2) RESUMEN GLOBAL: ¿cuánto de la deuda es real vs contaminación?
WITH balance_correcto AS (
  SELECT
    s.id,
    s.balance AS balance_actual,
    sch.name  AS sede,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount ELSE 0
      END
    ), 0) AS balance_solo_kiosco
  FROM students s
  LEFT JOIN schools sch ON sch.id = s.school_id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
    AND s.balance < 0
  GROUP BY s.id, s.balance, sch.name
)
SELECT
  COUNT(*)                                                        AS alumnos_con_balance_negativo,
  ROUND(SUM(balance_actual)::numeric, 2)                         AS deuda_total_en_BD,
  ROUND(SUM(CASE WHEN balance_solo_kiosco < 0 THEN balance_solo_kiosco ELSE 0 END)::numeric, 2)
                                                                  AS deuda_real_kiosco,
  ROUND(SUM(CASE WHEN balance_solo_kiosco >= 0 AND balance_actual < 0
            THEN balance_actual ELSE 0 END)::numeric, 2)         AS deuda_100pct_contaminacion,
  ROUND(SUM(balance_actual - balance_solo_kiosco)::numeric, 2)   AS total_contaminacion_almuerzos
FROM balance_correcto;


-- 3) RESUMEN POR COLEGIO: deuda real vs contaminación
WITH balance_correcto AS (
  SELECT
    s.id,
    s.balance AS balance_actual,
    sch.name  AS sede,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount ELSE 0
      END
    ), 0) AS balance_solo_kiosco
  FROM students s
  LEFT JOIN schools sch ON sch.id = s.school_id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
    AND s.balance < 0
  GROUP BY s.id, s.balance, sch.name
)
SELECT
  sede,
  COUNT(*)                                                     AS alumnos_en_negativo,
  ROUND(SUM(balance_actual)::numeric, 2)                       AS deuda_en_BD,
  ROUND(SUM(CASE WHEN balance_solo_kiosco < 0 THEN balance_solo_kiosco ELSE 0 END)::numeric, 2)
                                                               AS deuda_real_kiosco,
  ROUND(SUM(balance_actual - balance_solo_kiosco)::numeric, 2) AS contaminacion_almuerzos
FROM balance_correcto
GROUP BY sede
ORDER BY deuda_en_BD ASC;
