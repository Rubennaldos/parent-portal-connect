-- ============================================================================
-- CREAR DEUDA DE PRUEBA PARA PASARELA DE PAGOS
-- ============================================================================

-- PASO 1: Verificar qué estudiantes y padres hay
SELECT 
  s.id as student_id,
  s.full_name as estudiante,
  s.balance as saldo,
  pp.user_id as parent_user_id,
  p.email as email_padre
FROM students s
LEFT JOIN parent_profiles pp ON pp.id = s.parent_id
LEFT JOIN profiles p ON p.id = pp.user_id
WHERE s.is_active = true
ORDER BY s.full_name
LIMIT 5;

-- PASO 2: Insertar deuda de prueba (ajusta el student_id según el resultado anterior)
-- Copia el student_id del estudiante que quieras usar

-- Ejemplo de insertar deuda:
/*
INSERT INTO transactions (
  student_id,
  type,
  amount,
  description,
  balance_after,
  payment_status,
  payment_method,
  ticket_code,
  school_id,
  created_at
) VALUES (
  'PEGA_AQUI_EL_STUDENT_ID', -- ⚠️ Cambiar por el ID real del estudiante
  'purchase',
  -25.50, -- Monto negativo (deuda)
  'Compra de prueba - Snacks y bebida',
  0, -- Balance después (ajustar según sea necesario)
  'pending', -- ✅ Estado pendiente para que aparezca en deudas
  'credito',
  'TEST-DEUDA-001',
  (SELECT school_id FROM students WHERE id = 'PEGA_AQUI_EL_STUDENT_ID'), -- Mismo student_id
  NOW() - INTERVAL '3 days' -- Hace 3 días para que sea visible con delay de 2 días
);

-- También crear los items de la transacción
INSERT INTO transaction_items (
  transaction_id,
  product_name,
  quantity,
  unit_price,
  subtotal
) VALUES
  (
    (SELECT id FROM transactions WHERE ticket_code = 'TEST-DEUDA-001'),
    'Snack Premium',
    2,
    8.50,
    17.00
  ),
  (
    (SELECT id FROM transactions WHERE ticket_code = 'TEST-DEUDA-001'),
    'Bebida Refrescante',
    1,
    8.50,
    8.50
  );
*/

-- PASO 3: Verificar que se creó la deuda
/*
SELECT 
  t.ticket_code,
  t.amount,
  t.description,
  t.payment_status,
  t.created_at,
  s.full_name as estudiante,
  p.email as padre
FROM transactions t
JOIN students s ON s.id = t.student_id
LEFT JOIN parent_profiles pp ON pp.id = s.parent_id
LEFT JOIN profiles p ON p.id = pp.user_id
WHERE t.ticket_code = 'TEST-DEUDA-001';
*/

-- ============================================================================
-- INSTRUCCIONES:
-- ============================================================================
-- 1. Ejecuta el PASO 1 para ver qué estudiantes hay
-- 2. Copia el student_id del estudiante que quieras
-- 3. Descomenta el código del PASO 2 (quita los /* y */)
-- 4. Reemplaza 'PEGA_AQUI_EL_STUDENT_ID' con el ID real (2 veces)
-- 5. Ejecuta todo el PASO 2
-- 6. Ejecuta el PASO 3 para verificar
-- 7. Ahora el padre debería ver esta deuda en su portal
-- ============================================================================
