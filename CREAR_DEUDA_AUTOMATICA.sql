-- ============================================================================
-- CREAR DEUDA DE PRUEBA AUTOMÁTICA (VERSIÓN SIMPLE)
-- ============================================================================

DO $$
DECLARE
  v_student_id UUID;
  v_student_name TEXT;
  v_school_id UUID;
  v_parent_email TEXT;
  v_transaction_id UUID;
BEGIN
  -- Buscar el primer estudiante activo
  SELECT 
    s.id,
    s.full_name,
    s.school_id,
    p.email
  INTO 
    v_student_id,
    v_student_name,
    v_school_id,
    v_parent_email
  FROM students s
  LEFT JOIN parent_profiles pp ON pp.id = s.parent_id
  LEFT JOIN profiles p ON p.id = pp.user_id
  WHERE s.is_active = true
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RAISE NOTICE '⚠️ No se encontró ningún estudiante activo';
    RAISE NOTICE '';
    RAISE NOTICE '📋 PARA CREAR UN ESTUDIANTE:';
    RAISE NOTICE '1. Login como padre en el portal';
    RAISE NOTICE '2. Click en "Agregar Estudiante"';
    RAISE NOTICE '3. Llenar los datos del estudiante';
    RAISE NOTICE '';
    RAISE NOTICE '🔗 O ejecuta DIAGNOSTICO_BASE_DATOS.sql para ver qué hay en la BD';
    RETURN; -- Salir sin error
  END IF;

  -- Crear la transacción (deuda)
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
    v_student_id,
    'purchase',
    -35.00, -- S/ 35 de deuda
    'Compra de prueba - Snacks del kiosco',
    0,
    'pending', -- ✅ Estado pendiente
    'credito',
    'DEUDA-TEST-' || EXTRACT(EPOCH FROM NOW())::TEXT,
    v_school_id,
    NOW() - INTERVAL '4 days' -- Hace 4 días para que sea visible
  )
  RETURNING id INTO v_transaction_id;

  -- Crear items de la compra
  INSERT INTO transaction_items (
    transaction_id,
    product_name,
    quantity,
    unit_price,
    subtotal
  ) VALUES
    (v_transaction_id, 'Sandwich Especial', 2, 10.00, 20.00),
    (v_transaction_id, 'Jugo Natural', 2, 5.00, 10.00),
    (v_transaction_id, 'Galletas', 1, 5.00, 5.00);

  -- Mostrar información
  RAISE NOTICE '✅ Deuda de prueba creada exitosamente';
  RAISE NOTICE '📋 Estudiante: %', v_student_name;
  RAISE NOTICE '💰 Monto: S/ 35.00';
  RAISE NOTICE '📧 Padre: %', v_parent_email;
  RAISE NOTICE '🎫 Ticket: DEUDA-TEST-*';
  RAISE NOTICE '';
  RAISE NOTICE '🔍 El padre puede verla en: Portal → Pestaña Pagos';
END $$;

-- Verificar la deuda creada
SELECT 
  t.ticket_code as "Ticket",
  s.full_name as "Estudiante",
  t.amount as "Monto",
  t.payment_status as "Estado",
  t.created_at as "Fecha",
  p.email as "Padre"
FROM transactions t
JOIN students s ON s.id = t.student_id
LEFT JOIN parent_profiles pp ON pp.id = s.parent_id
LEFT JOIN profiles p ON p.id = pp.user_id
WHERE t.ticket_code LIKE 'DEUDA-TEST-%'
ORDER BY t.created_at DESC
LIMIT 1;
