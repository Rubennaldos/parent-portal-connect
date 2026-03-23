-- ================================================================
-- RESUMEN FINANCIERO GLOBAL DEL SISTEMA
-- Cuánto saldo total existe vs cuánto se recargó por voucher
-- ================================================================

SELECT
  COUNT(*)                                    AS total_alumnos_con_saldo,
  ROUND(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END)::numeric, 2)
                                              AS saldo_positivo_total,
  ROUND(SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END)::numeric, 2)
                                              AS deuda_total_negativa,
  ROUND(SUM(balance)::numeric, 2)             AS saldo_neto_total
FROM students
WHERE balance != 0
  AND is_active = true;

-- Cuánto se recargó por voucher (canal oficial)
SELECT
  ROUND(SUM(amount)::numeric, 2)             AS total_recargado_vouchers,
  COUNT(DISTINCT student_id)                 AS alumnos_con_voucher,
  COUNT(*)                                   AS total_recargas
FROM recharge_requests
WHERE status = 'approved'
  AND request_type = 'recharge';

-- Diferencia: saldo sin respaldo en vouchers
SELECT
  (SELECT ROUND(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END)::numeric,2)
   FROM students WHERE balance != 0 AND is_active = true) AS saldo_positivo_sistema,
  (SELECT ROUND(SUM(amount)::numeric,2)
   FROM recharge_requests WHERE status = 'approved' AND request_type = 'recharge') AS recargado_por_voucher,
  (SELECT ROUND(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END)::numeric,2)
   FROM students WHERE balance != 0 AND is_active = true)
  -
  (SELECT COALESCE(ROUND(SUM(amount)::numeric,2), 0)
   FROM recharge_requests WHERE status = 'approved' AND request_type = 'recharge')
  AS diferencia_sin_voucher;

-- Desglose por colegio
SELECT
  sch.name                                   AS colegio,
  COUNT(s.id)                                AS alumnos_con_saldo,
  ROUND(SUM(CASE WHEN s.balance > 0 THEN s.balance ELSE 0 END)::numeric, 2)
                                             AS saldo_positivo,
  ROUND(SUM(CASE WHEN s.balance < 0 THEN s.balance ELSE 0 END)::numeric, 2)
                                             AS deuda_acumulada,
  COALESCE(ROUND(SUM(rr.amount)::numeric, 2), 0)
                                             AS recargado_por_voucher,
  ROUND(
    SUM(CASE WHEN s.balance > 0 THEN s.balance ELSE 0 END)
    - COALESCE(SUM(rr.amount), 0)
  ::numeric, 2)                              AS saldo_sin_voucher
FROM students s
JOIN schools sch ON sch.id = s.school_id
LEFT JOIN recharge_requests rr
  ON rr.student_id = s.id
  AND rr.status = 'approved'
  AND rr.request_type = 'recharge'
WHERE s.balance != 0
  AND s.is_active = true
GROUP BY sch.name
ORDER BY saldo_positivo DESC;
