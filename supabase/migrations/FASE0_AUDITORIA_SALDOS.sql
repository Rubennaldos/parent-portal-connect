-- ============================================================
-- FASE 0: Auditoría de saldos de kiosco
-- Compara students.balance vs la suma de transacciones
-- que REALMENTE afectan el saldo (recargas + compras kiosco pagadas con saldo + devoluciones)
-- ============================================================

-- 1. Ver TODOS los alumnos con discrepancia entre balance y transacciones
WITH saldo_calculado AS (
  SELECT 
    t.student_id,
    -- Recargas aprobadas (suman)
    COALESCE(SUM(CASE 
      WHEN t.type = 'recharge' AND t.payment_status = 'paid' 
      THEN t.amount 
    END), 0) AS total_recargas,
    -- Compras de kiosco pagadas con saldo (restan, amount es negativo)
    COALESCE(SUM(CASE 
      WHEN t.type = 'purchase' 
        AND t.payment_status = 'paid' 
        AND NOT t.is_deleted
        AND (t.payment_method = 'saldo' OR t.payment_method IS NULL)
        AND (t.metadata->>'lunch_order_id') IS NULL
      THEN t.amount 
    END), 0) AS total_compras_saldo,
    -- Devoluciones (suman, porque se revierte la compra)
    COALESCE(SUM(CASE 
      WHEN t.is_deleted = true 
      THEN ABS(t.amount) 
    END), 0) AS total_devoluciones
  FROM transactions t
  GROUP BY t.student_id
)
SELECT 
  s.id AS student_id,
  s.full_name,
  s.balance AS saldo_sistema,
  COALESCE(sc.total_recargas, 0) AS recargas,
  COALESCE(sc.total_compras_saldo, 0) AS compras_saldo,
  COALESCE(sc.total_devoluciones, 0) AS devoluciones,
  COALESCE(sc.total_recargas, 0) + COALESCE(sc.total_compras_saldo, 0) + COALESCE(sc.total_devoluciones, 0) AS saldo_calculado,
  s.balance - (COALESCE(sc.total_recargas, 0) + COALESCE(sc.total_compras_saldo, 0) + COALESCE(sc.total_devoluciones, 0)) AS diferencia,
  CASE 
    WHEN s.free_account = false THEN 'Con Recargas'
    ELSE 'Cuenta Libre'
  END AS tipo_cuenta,
  s.limit_type,
  s.daily_limit,
  s.weekly_limit,
  s.monthly_limit
FROM students s
LEFT JOIN saldo_calculado sc ON sc.student_id = s.id
WHERE ABS(
  s.balance - (COALESCE(sc.total_recargas, 0) + COALESCE(sc.total_compras_saldo, 0) + COALESCE(sc.total_devoluciones, 0))
) > 0.01
ORDER BY ABS(s.balance - (COALESCE(sc.total_recargas, 0) + COALESCE(sc.total_compras_saldo, 0) + COALESCE(sc.total_devoluciones, 0))) DESC;

-- 2. Resumen global: cuántos alumnos tienen discrepancia
WITH saldo_calculado AS (
  SELECT 
    t.student_id,
    COALESCE(SUM(CASE 
      WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount 
    END), 0) +
    COALESCE(SUM(CASE 
      WHEN t.type = 'purchase' AND t.payment_status = 'paid' AND NOT t.is_deleted
        AND (t.payment_method = 'saldo' OR t.payment_method IS NULL)
        AND (t.metadata->>'lunch_order_id') IS NULL
      THEN t.amount 
    END), 0) +
    COALESCE(SUM(CASE 
      WHEN t.is_deleted = true THEN ABS(t.amount) 
    END), 0) AS calculado
  FROM transactions t
  GROUP BY t.student_id
)
SELECT 
  COUNT(*) FILTER (WHERE ABS(s.balance - COALESCE(sc.calculado, 0)) > 0.01) AS alumnos_con_discrepancia,
  COUNT(*) FILTER (WHERE ABS(s.balance - COALESCE(sc.calculado, 0)) <= 0.01) AS alumnos_correctos,
  COUNT(*) AS total_alumnos
FROM students s
LEFT JOIN saldo_calculado sc ON sc.student_id = s.id;
