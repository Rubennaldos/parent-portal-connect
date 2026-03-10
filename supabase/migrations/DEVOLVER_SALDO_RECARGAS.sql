-- ====================================================
-- SCRIPT DE DEVOLUCIÓN DE SALDO
-- ====================================================
-- ⚠️ IMPORTANTE: Ejecutar SOLO después de que el admin haya devuelto el dinero físicamente
-- ====================================================

-- ====================================================
-- OPCIÓN 1: DEVOLVER SALDO DE UN ALUMNO ESPECÍFICO
-- ====================================================
-- Reemplaza los valores entre < > según el caso

/*
-- PASO 1: Verificar el saldo actual del alumno
SELECT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_actual,
  p.email AS email_padre,
  p.full_name AS nombre_padre
FROM students s
INNER JOIN profiles p ON s.parent_id = p.id
WHERE s.id = '<PEGA-AQUI-EL-STUDENT-ID>';

-- PASO 2: Poner el saldo en 0
UPDATE students
SET 
  balance = 0,
  updated_at = NOW()
WHERE id = '<PEGA-AQUI-EL-STUDENT-ID>';

-- PASO 3: Registrar la devolución en el historial
INSERT INTO transactions (
  student_id,
  type,
  amount,
  status,
  payment_method,
  description,
  payment_status,
  created_at
)
VALUES (
  '<PEGA-AQUI-EL-STUDENT-ID>',
  'refund',
  <MONTO_DEVUELTO>,  -- Ejemplo: 60.00
  'completed',
  '<METODO_DEVOLUCION>',  -- 'plin', 'yape', 'cash', 'transfer'
  'Devolución de recarga — Error de concepto (único caso)',
  'paid',
  NOW()
);

-- PASO 4: Verificar que se aplicó correctamente
SELECT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_despues,
  t.amount AS monto_devuelto,
  t.description AS descripcion_devolucion
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id 
  AND t.type = 'refund'
  AND t.description LIKE '%Devolución de recarga%'
WHERE s.id = '<PEGA-AQUI-EL-STUDENT-ID>'
ORDER BY t.created_at DESC
LIMIT 1;
*/

-- ====================================================
-- OPCIÓN 2: DEVOLVER SALDO DE MÚLTIPLES ALUMNOS
-- ====================================================
-- Lista de IDs de alumnos que necesitan devolución
-- (Reemplaza con los IDs reales)

/*
-- PASO 1: Verificar los saldos de los alumnos seleccionados
SELECT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_actual,
  p.email AS email_padre,
  p.full_name AS nombre_padre
FROM students s
INNER JOIN profiles p ON s.parent_id = p.id
WHERE s.id IN (
  '<STUDENT-ID-1>',
  '<STUDENT-ID-2>',
  '<STUDENT-ID-3>'
  -- Agregar más IDs según sea necesario
)
ORDER BY s.full_name;

-- PASO 2: Poner todos los saldos en 0
UPDATE students
SET 
  balance = 0,
  updated_at = NOW()
WHERE id IN (
  '<STUDENT-ID-1>',
  '<STUDENT-ID-2>',
  '<STUDENT-ID-3>'
  -- Agregar más IDs según sea necesario
);

-- PASO 3: Registrar las devoluciones (una por cada alumno)
-- Ejemplo para el primer alumno:
INSERT INTO transactions (
  student_id,
  type,
  amount,
  status,
  payment_method,
  description,
  payment_status,
  created_at
)
VALUES 
  ('<STUDENT-ID-1>', 'refund', <MONTO-1>, 'completed', '<METODO>', 'Devolución de recarga — Error de concepto (único caso)', 'paid', NOW()),
  ('<STUDENT-ID-2>', 'refund', <MONTO-2>, 'completed', '<METODO>', 'Devolución de recarga — Error de concepto (único caso)', 'paid', NOW()),
  ('<STUDENT-ID-3>', 'refund', <MONTO-3>, 'completed', '<METODO>', 'Devolución de recarga — Error de concepto (único caso)', 'paid', NOW());
  -- Agregar más filas según sea necesario

-- PASO 4: Verificar que se aplicaron correctamente
SELECT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_despues,
  t.amount AS monto_devuelto,
  t.created_at AS fecha_devolucion
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id 
  AND t.type = 'refund'
  AND t.description LIKE '%Devolución de recarga%'
WHERE s.id IN (
  '<STUDENT-ID-1>',
  '<STUDENT-ID-2>',
  '<STUDENT-ID-3>'
)
ORDER BY t.created_at DESC;
*/

-- ====================================================
-- OPCIÓN 3: DEVOLVER SOLO A PADRES QUE USARON SALDO PARA ALMUERZOS
-- ====================================================
-- Esta opción devuelve automáticamente solo a los casos problemáticos

/*
-- PASO 1: Verificar quiénes son los afectados
SELECT DISTINCT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_actual,
  p.email AS email_padre,
  p.full_name AS nombre_padre,
  SUM(t.amount) AS total_almuerzos_pagados_con_saldo
FROM transactions t
INNER JOIN students s ON t.student_id = s.id
INNER JOIN profiles p ON s.parent_id = p.id
WHERE t.type = 'purchase'
  AND t.payment_method = 'saldo'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND t.payment_status = 'paid'
  AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY s.id, s.full_name, s.balance, p.email, p.full_name
ORDER BY s.full_name;

-- PASO 2: Poner saldos en 0 para estos casos
UPDATE students
SET 
  balance = 0,
  updated_at = NOW()
WHERE id IN (
  SELECT DISTINCT s.id
  FROM transactions t
  INNER JOIN students s ON t.student_id = s.id
  WHERE t.type = 'purchase'
    AND t.payment_method = 'saldo'
    AND t.metadata->>'lunch_order_id' IS NOT NULL
    AND t.payment_status = 'paid'
    AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
);

-- PASO 3: Registrar devoluciones (una por cada alumno afectado)
-- ⚠️ IMPORTANTE: Ajustar el monto según lo que el admin haya devuelto
INSERT INTO transactions (
  student_id,
  type,
  amount,
  status,
  payment_method,
  description,
  payment_status,
  created_at
)
SELECT DISTINCT
  s.id,
  'refund',
  s.balance,  -- Usar el saldo actual como monto devuelto
  'completed',
  'plin',  -- Ajustar según el método de devolución
  'Devolución de recarga — Almuerzo pagado incorrectamente con saldo',
  'paid',
  NOW()
FROM students s
WHERE s.id IN (
  SELECT DISTINCT s2.id
  FROM transactions t
  INNER JOIN students s2 ON t.student_id = s2.id
  WHERE t.type = 'purchase'
    AND t.payment_method = 'saldo'
    AND t.metadata->>'lunch_order_id' IS NOT NULL
    AND t.payment_status = 'paid'
    AND t.created_at >= CURRENT_DATE - INTERVAL '90 days'
)
AND s.balance > 0;  -- Solo si aún tiene saldo

-- PASO 4: Verificar
SELECT
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_despues,
  COUNT(t.id) AS num_devoluciones
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id 
  AND t.type = 'refund'
  AND t.description LIKE '%Devolución de recarga%'
WHERE s.id IN (
  SELECT DISTINCT s2.id
  FROM transactions t2
  INNER JOIN students s2 ON t2.student_id = s2.id
  WHERE t2.type = 'purchase'
    AND t2.payment_method = 'saldo'
    AND t2.metadata->>'lunch_order_id' IS NOT NULL
    AND t2.payment_status = 'paid'
    AND t2.created_at >= CURRENT_DATE - INTERVAL '90 days'
)
GROUP BY s.id, s.full_name, s.balance
ORDER BY s.full_name;
*/
