-- =========================================================
-- 🔍 DIAGNÓSTICO: Padres recargan pero el saldo no baja
-- =========================================================
-- PROBLEMA: Los padres recargan saldo, los hijos compran
-- en el kiosco, pero el balance NO se descuenta.
-- 
-- CAUSA RAÍZ: El POS.tsx (línea 1097) tiene:
--   const isFreeAccount = selectedStudent.free_account !== false;
--   // Por defecto true
--
-- Esto significa que si free_account es TRUE o NULL, 
-- el sistema NO descuenta del saldo. Solo crea deudas.
-- 
-- El padre recarga → balance sube
-- El hijo compra → el POS ve "cuenta libre" → NO descuenta
-- → El padre ve su saldo intacto
-- =========================================================

-- PASO 1: Ver cuántos estudiantes tienen free_account = true con saldo positivo
-- (estos son los afectados)
SELECT 
  s.id AS student_id,
  s.full_name AS estudiante,
  s.balance AS saldo_actual,
  s.free_account AS cuenta_libre,
  s.grade AS grado,
  s.section AS seccion,
  sch.name AS colegio,
  sch.code AS codigo_colegio,
  p.email AS email_padre
FROM students s
LEFT JOIN schools sch ON s.school_id = sch.id
LEFT JOIN auth.users p ON s.parent_id = p.id
WHERE s.is_active = true
  AND s.balance > 0
  AND (s.free_account = true OR s.free_account IS NULL)
ORDER BY s.balance DESC;

-- PASO 2: Ver las recargas recientes de estos estudiantes
SELECT 
  s.full_name AS estudiante,
  s.balance AS saldo_actual,
  s.free_account AS cuenta_libre,
  t.type AS tipo,
  t.amount AS monto,
  t.payment_status AS estado_pago,
  t.description AS descripcion,
  t.created_at AS fecha,
  sch.name AS colegio
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.is_active = true
  AND s.balance > 0
  AND (s.free_account = true OR s.free_account IS NULL)
  AND t.type = 'recharge'
  AND t.created_at >= NOW() - INTERVAL '30 days'
ORDER BY t.created_at DESC;

-- PASO 3: Ver compras de estos mismos estudiantes (¿se crearon como deuda?)
SELECT 
  s.full_name AS estudiante,
  s.balance AS saldo_actual,
  s.free_account AS cuenta_libre,
  t.amount AS monto_compra,
  t.payment_status AS estado_pago,
  t.description AS descripcion,
  t.balance_after AS saldo_despues,
  t.created_at AS fecha,
  sch.name AS colegio
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
LEFT JOIN schools sch ON s.school_id = sch.id
WHERE s.is_active = true
  AND s.balance > 0
  AND (s.free_account = true OR s.free_account IS NULL)
  AND t.type = 'purchase'
  AND t.created_at >= NOW() - INTERVAL '30 days'
ORDER BY t.created_at DESC;

-- PASO 4: Resumen - ¿Cuántos estudiantes tienen recargas pero el POS no les descuenta?
SELECT 
  sch.name AS colegio,
  COUNT(DISTINCT s.id) AS estudiantes_afectados,
  SUM(s.balance) AS saldo_total_sin_descontar,
  COUNT(DISTINCT CASE WHEN t.type = 'purchase' AND t.payment_status = 'pending' 
    THEN t.id END) AS compras_como_deuda,
  SUM(CASE WHEN t.type = 'purchase' AND t.payment_status = 'pending' 
    THEN ABS(t.amount) ELSE 0 END) AS total_deuda_generada
FROM students s
LEFT JOIN schools sch ON s.school_id = sch.id
LEFT JOIN transactions t ON t.student_id = s.id 
  AND t.created_at >= NOW() - INTERVAL '30 days'
WHERE s.is_active = true
  AND s.balance > 0
  AND (s.free_account = true OR s.free_account IS NULL)
GROUP BY sch.name
ORDER BY estudiantes_afectados DESC;

-- =========================================================
-- 📌 CONCLUSIÓN:
-- Si ves estudiantes con saldo > 0 y free_account = true,
-- ESE es el bug. El POS nunca les descuenta.
--
-- SOLUCIÓN: Cambiar esos estudiantes a free_account = false
-- para que el POS use su saldo de recargas.
-- =========================================================
