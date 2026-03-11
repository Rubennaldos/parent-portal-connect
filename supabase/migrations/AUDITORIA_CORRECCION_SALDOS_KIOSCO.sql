-- ============================================================
-- AUDITORÍA Y CORRECCIÓN DE SALDOS DE KIOSCO
-- Fecha: 2026-03-10
-- ============================================================
-- IMPORTANTE: Este script primero muestra el diagnóstico.
-- El UPDATE final está comentado. Revisa los resultados antes de descomentar.
-- ============================================================

-- PASO 1: Ver todos los alumnos con diferencia de saldo
-- Fórmula: saldo_correcto = recargas - compras_desde_saldo + devoluciones
SELECT 
  s.id,
  s.full_name,
  s.grade || ' - ' || s.section AS salon,
  s.balance AS saldo_sistema,
  COALESCE(r.recargas, 0) AS recargas,
  COALESCE(r.compras_saldo, 0) AS compras_saldo,
  COALESCE(r.devuelto, 0) AS devuelto,
  COALESCE(r.recargas, 0) + COALESCE(r.compras_saldo, 0) + COALESCE(r.devuelto, 0) AS saldo_correcto,
  s.balance - (COALESCE(r.recargas, 0) + COALESCE(r.compras_saldo, 0) + COALESCE(r.devuelto, 0)) AS diferencia,
  CASE 
    WHEN s.balance > (COALESCE(r.recargas, 0) + COALESCE(r.compras_saldo, 0) + COALESCE(r.devuelto, 0)) 
    THEN 'SALDO DE MAS → si corrijo BAJA el saldo'
    WHEN s.balance < (COALESCE(r.recargas, 0) + COALESCE(r.compras_saldo, 0) + COALESCE(r.devuelto, 0)) 
    THEN 'SALDO DE MENOS → si corrijo SUBE el saldo'
    ELSE 'OK'
  END AS impacto_al_corregir
FROM students s
LEFT JOIN (
  SELECT 
    student_id,
    SUM(CASE WHEN type = 'recharge' AND payment_status = 'paid' THEN amount ELSE 0 END) AS recargas,
    SUM(CASE WHEN type = 'purchase' AND payment_status = 'paid' AND is_deleted = false 
             AND (payment_method = 'saldo' OR payment_method IS NULL) THEN amount ELSE 0 END) AS compras_saldo,
    SUM(CASE WHEN is_deleted = true THEN ABS(amount) ELSE 0 END) AS devuelto
  FROM transactions
  GROUP BY student_id
) r ON r.student_id = s.id
WHERE s.free_account = false
AND ABS(
  s.balance - (COALESCE(r.recargas, 0) + COALESCE(r.compras_saldo, 0) + COALESCE(r.devuelto, 0))
) > 0.01
ORDER BY ABS(
  s.balance - (COALESCE(r.recargas, 0) + COALESCE(r.compras_saldo, 0) + COALESCE(r.devuelto, 0))
) DESC;


-- ============================================================
-- PASO 2: CORRECCIÓN (DESCOMENTA SOLO CUANDO ESTÉS SEGURO)
-- Esto actualiza el balance de cada alumno al saldo_correcto
-- ============================================================

/*
UPDATE students s
SET balance = COALESCE(calc.saldo_correcto, 0)
FROM (
  SELECT 
    student_id,
    SUM(CASE WHEN type = 'recharge' AND payment_status = 'paid' THEN amount ELSE 0 END)
    + SUM(CASE WHEN type = 'purchase' AND payment_status = 'paid' AND is_deleted = false 
               AND (payment_method = 'saldo' OR payment_method IS NULL) THEN amount ELSE 0 END)
    + SUM(CASE WHEN is_deleted = true THEN ABS(amount) ELSE 0 END) AS saldo_correcto
  FROM transactions
  GROUP BY student_id
) calc
WHERE calc.student_id = s.id
AND s.free_account = false
AND ABS(
  s.balance - COALESCE(calc.saldo_correcto, 0)
) > 0.01;
*/
