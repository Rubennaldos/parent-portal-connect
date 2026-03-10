-- =====================================================
-- BORRAR RECARGAS - Hijos Vilchez (Roy Alexis, Malek, Anthuan)
-- Colegios: Miraflores, Little St. George's
-- =====================================================

-- PASO 1: Ver los 3 niños y cuáles tienen recargas/saldo
-- (Ejecuta esto primero para confirmar los 2 que tienen recarga)
SELECT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_actual,
  sch.name AS colegio,
  COALESCE(rec.total_recargas, 0) AS total_recargas
FROM students s
LEFT JOIN schools sch ON sch.id = s.school_id
LEFT JOIN (
  SELECT student_id, SUM(amount) AS total_recargas
  FROM transactions
  WHERE type = 'recharge' AND (payment_status IS NULL OR payment_status != 'cancelled')
  GROUP BY student_id
) rec ON rec.student_id = s.id
WHERE (
  s.full_name ILIKE '%Roy Alexis Vilchez Vargas%'
  OR s.full_name ILIKE '%Malek Vilchez Garcia%'
  OR s.full_name ILIKE '%Anthuan Vilchez%García%'
  OR s.full_name ILIKE '%Anthuan Vilchez Garcia%'
)
ORDER BY s.full_name;

-- Anota los student_id y saldo_actual de los que tengan saldo_actual > 0 o total_recargas > 0.
-- Luego ejecuta PASO 2 y PASO 3 reemplazando los IDs y montos si hace falta.


-- PASO 2: Poner saldo en 0 solo para los que tienen recargas (los 2 niños)
UPDATE students
SET balance = 0
WHERE (balance > 0 OR id IN (
  SELECT student_id FROM transactions WHERE type = 'recharge' AND (payment_status IS NULL OR payment_status != 'cancelled')
))
AND (
  full_name ILIKE '%Roy Alexis Vilchez Vargas%'
  OR full_name ILIKE '%Malek Vilchez Garcia%'
  OR full_name ILIKE '%Anthuan Vilchez%García%'
  OR full_name ILIKE '%Anthuan Vilchez Garcia%'
);


-- PASO 3: Registrar devolución (refund) por cada uno que tenía recargas
INSERT INTO transactions (student_id, type, amount, payment_method, description, payment_status, created_at)
SELECT
  s.id,
  'refund',
  s.monto_recargas,
  'cash',
  'Devolución recarga kiosco — error de concepto (sede sin kiosco)',
  'paid',
  NOW()
FROM (
  SELECT st.id, COALESCE(SUM(t.amount), 0) AS monto_recargas
  FROM students st
  LEFT JOIN transactions t ON t.student_id = st.id AND t.type = 'recharge'
    AND (t.payment_status IS NULL OR t.payment_status != 'cancelled')
  WHERE (
    st.full_name ILIKE '%Roy Alexis Vilchez Vargas%'
    OR st.full_name ILIKE '%Malek Vilchez Garcia%'
    OR st.full_name ILIKE '%Anthuan Vilchez%García%'
    OR st.full_name ILIKE '%Anthuan Vilchez Garcia%'
  )
  GROUP BY st.id
  HAVING COALESCE(SUM(t.amount), 0) > 0
) s;

-- Nota: Si PASO 2 ya puso balance en 0, el SELECT de PASO 3 usa el total de recargas por estudiante (balance_antes).
-- Si prefieres hacerlo manual con montos fijos, usa esto en su lugar:

/*
INSERT INTO transactions (student_id, type, amount, payment_method, description, payment_status, created_at)
VALUES
  ('<STUDENT_ID_1>', 'refund', <MONTO_1>, 'cash', 'Devolución recarga kiosco — error de concepto (sede sin kiosco)', 'paid', NOW()),
  ('<STUDENT_ID_2>', 'refund', <MONTO_2>, 'cash', 'Devolución recarga kiosco — error de concepto (sede sin kiosco)', 'paid', NOW());
*/
