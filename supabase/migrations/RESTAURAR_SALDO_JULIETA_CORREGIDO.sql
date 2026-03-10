-- ═══════════════════════════════════════════════
-- RESTAURAR SALDO: Julieta Neyra Lamas (CORREGIDO)
-- ═══════════════════════════════════════════════

-- DIAGNÓSTICO ACTUALIZADO:
-- ✅ Recarga de 50 soles confirmada (aprobada el 1 de marzo)
-- ❌ Saldo actual: 34.00
-- ✅ Saldo que debería tener: 36.50 (50 - 13.50 de compra POS)
-- ❌ Diferencia: -2.50 (falta restaurar 2.50 soles)

-- PASO 1: Verificar saldo actual
SELECT 
  id,
  full_name,
  balance AS saldo_actual
FROM students
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- PASO 2: Calcular saldo que debería tener
SELECT 
  s.full_name AS estudiante,
  s.balance AS saldo_actual,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) AS total_recargas,
  COALESCE(SUM(CASE 
    WHEN t.type = 'purchase' 
    AND t.payment_status = 'paid'
    AND (t.metadata->>'source')::text NOT LIKE '%lunch%'
    AND (t.metadata->>'source')::text NOT LIKE '%almuerzo%'
    AND (t.metadata->>'source')::text NOT LIKE '%unified_calendar%'
    THEN ABS(t.amount) 
    ELSE 0 
  END), 0) AS total_compras_kiosco,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) 
  - COALESCE(SUM(CASE 
    WHEN t.type = 'purchase' 
    AND t.payment_status = 'paid'
    AND (t.metadata->>'source')::text NOT LIKE '%lunch%'
    AND (t.metadata->>'source')::text NOT LIKE '%almuerzo%'
    AND (t.metadata->>'source')::text NOT LIKE '%unified_calendar%'
    THEN ABS(t.amount) 
    ELSE 0 
  END), 0) AS saldo_que_deberia_tener,
  s.balance - (
    COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) 
    - COALESCE(SUM(CASE 
      WHEN t.type = 'purchase' 
      AND t.payment_status = 'paid'
      AND (t.metadata->>'source')::text NOT LIKE '%lunch%'
      AND (t.metadata->>'source')::text NOT LIKE '%almuerzo%'
      AND (t.metadata->>'source')::text NOT LIKE '%unified_calendar%'
      THEN ABS(t.amount) 
      ELSE 0 
    END), 0)
  ) AS diferencia_a_restaurar
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id
WHERE s.id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
GROUP BY s.id, s.full_name, s.balance;

-- PASO 3: Restaurar la diferencia (2.50 soles)
UPDATE students
SET balance = balance + 2.50
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- PASO 4: Verificar saldo después de restaurar
SELECT 
  id,
  full_name,
  balance AS saldo_actualizado,
  'Debería ser: 36.50' AS saldo_esperado
FROM students
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';
