-- ============================================================
-- RPC: cancel_lunch_order_with_wallet_credit
-- ============================================================
-- Anula un almuerzo y, si ya fue boleteado a SUNAT, acredita
-- el monto en la billetera interna del alumno.
--
-- ÁRBOL DE DECISIÓN:
--
--   lunch_order.status = 'cancelled'?
--     → ERROR: ya está anulado
--
--   ¿Existe transacción vinculada?
--     NO → solo cancelar el pedido (ej: almuerzo pedido pero no cobrado)
--     SÍ:
--       billing_status ≠ 'sent' → cancelar pedido + opcionalmente
--                                  revertir la transacción (no hay boleta)
--       billing_status = 'sent' → [FLUJO BILLETERA]
--                                  cancelar pedido + acreditar wallet
--
-- FLUJO BILLETERA (el caso principal de esta función):
--   1. Calcular monto del almuerzo (misma lógica de precio que en CXC)
--   2. UPDATE lunch_orders → status='cancelled', is_cancelled=true
--   3. INSERT wallet_transactions → type='cancellation_credit'
--   4. UPDATE students.wallet_balance += monto
--   5. INSERT huella_digital_logs
--
-- IMPORTANTE:
--   La transacción fiscal (billing_status='sent') NO se modifica.
--   El trigger trg_protect_sent_transactions la protege y eso es correcto.
--   El dinero real ya fue boleteado a SUNAT. La compensación es interna.
--
-- RETORNA:
--   { success, flow, wallet_credit_amount, new_wallet_balance,
--     wallet_tx_id, lunch_order_id }
-- ============================================================


-- ── HELPER: adjust_student_wallet_balance ────────────────────────────────────
-- Operación atómica para tocar wallet_balance.
-- NUNCA hacer: leer → calcular → escribir (causa race conditions).

DROP FUNCTION IF EXISTS adjust_student_wallet_balance(uuid, numeric);

CREATE OR REPLACE FUNCTION adjust_student_wallet_balance(
  p_student_id  uuid,
  p_delta       numeric   -- positivo = crédito, negativo = débito
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE students
  SET    wallet_balance = wallet_balance + p_delta
  WHERE  id = p_student_id
  RETURNING wallet_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_ERR: Alumno % no encontrado en la tabla students',
      p_student_id;
  END IF;

  -- Guardia contra saldo negativo (no debe ocurrir si el RPC de cobro
  -- verifica el saldo antes, pero es una red de seguridad):
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'WALLET_ERR: El saldo de la billetera no puede ser negativo '
                    '(alumno %, delta %, resultado %)',
      p_student_id, p_delta, v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_student_wallet_balance(uuid, numeric)
  TO authenticated;

COMMENT ON FUNCTION adjust_student_wallet_balance IS
  'Suma p_delta al wallet_balance del alumno de forma atómica. '
  'Positivo = acreditar, Negativo = debitar. '
  'Lanza excepción si el resultado sería negativo.';


-- ── RPC PRINCIPAL ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS cancel_lunch_order_with_wallet_credit(uuid, text);

CREATE OR REPLACE FUNCTION cancel_lunch_order_with_wallet_credit(
  p_lunch_order_id  uuid,
  p_reason          text  DEFAULT 'Anulación solicitada'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Auth
  v_caller_id         uuid;
  v_caller_role       text;

  -- Datos del pedido
  lo_rec              record;

  -- Datos de la transacción vinculada (si existe)
  tx_rec              record;

  -- Precio calculado del almuerzo
  v_credit_amount     numeric;

  -- Resultado del wallet
  v_wallet_tx_id      uuid;
  v_new_wallet_bal    numeric;

  -- Flujo elegido (para el log y el retorno)
  v_flow              text;
BEGIN
  -- ── AUTENTICACIÓN ───────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  -- Solo admins pueden anular almuerzos (no padres)
  SELECT role INTO v_caller_role
  FROM   profiles
  WHERE  id = v_caller_id;

  IF v_caller_role NOT IN (
    'admin_general', 'gestor_unidad', 'cajero', 'operador_caja',
    'supervisor_red', 'superadmin'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Solo administradores pueden anular almuerzos';
  END IF;


  -- ── PASO 1: OBTENER Y BLOQUEAR EL PEDIDO ───────────────────────────────────
  SELECT
    lo.id,
    lo.status,
    lo.is_cancelled,
    lo.student_id,
    lo.teacher_id,
    lo.order_date,
    lo.final_price,
    lo.category_id,
    lo.quantity,
    lo.manual_name,
    COALESCE(lo.school_id, st.school_id, tp.school_id_1)  AS school_id,
    -- Precio efectivo del almuerzo (misma lógica de get_billing_consolidated_debtors)
    ABS(ROUND(
      CASE
        WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
          THEN lo.final_price
        WHEN lc.price IS NOT NULL AND lc.price > 0
          THEN lc.price * COALESCE(lo.quantity, 1)
        WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
          THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
        ELSE 7.50 * COALESCE(lo.quantity, 1)
      END, 2
    ))                                                     AS effective_price,
    lc.name                                                AS category_name,
    st.full_name                                           AS student_name
  INTO lo_rec
  FROM   lunch_orders      lo
  LEFT JOIN lunch_categories    lc   ON lc.id  = lo.category_id
  LEFT JOIN students            st   ON st.id  = lo.student_id
  LEFT JOIN teacher_profiles    tp   ON tp.id  = lo.teacher_id
  LEFT JOIN lunch_configuration lcfg
         ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
  WHERE  lo.id = p_lunch_order_id
  FOR UPDATE;  -- candado: nadie más puede tocar este pedido mientras estamos aquí

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: El pedido de almuerzo % no existe',
      p_lunch_order_id;
  END IF;

  IF lo_rec.status = 'cancelled' OR lo_rec.is_cancelled = true THEN
    RAISE EXCEPTION 'ALREADY_CANCELLED: El pedido % ya está anulado',
      p_lunch_order_id;
  END IF;

  -- Solo almuerzos de alumnos tienen billetera.
  -- Los pedidos de docentes (teacher_id != NULL, student_id = NULL)
  -- se anulan sin crédito de wallet.
  IF lo_rec.student_id IS NULL THEN
    v_flow := 'cancel_only_teacher_order';
  END IF;


  -- ── PASO 2: BUSCAR TRANSACCIÓN FISCAL VINCULADA ─────────────────────────────
  -- Una transacción "cubre" este pedido si tiene su ID en metadata.
  SELECT
    t.id,
    t.amount,
    t.payment_status,
    t.billing_status,
    t.school_id
  INTO tx_rec
  FROM   transactions t
  WHERE  t.metadata->>'lunch_order_id' = p_lunch_order_id::text
    AND  t.is_deleted = false
    AND  t.payment_status IN ('paid', 'partial')
  ORDER BY t.created_at DESC  -- si hubiese duplicados (no debería), tomar el más reciente
  LIMIT 1;
  -- tx_rec.id será NULL si no hay transacción vinculada


  -- ── PASO 3: DECIDIR EL FLUJO ─────────────────────────────────────────────────

  IF tx_rec.id IS NULL THEN
    -- No hay transacción → el almuerzo aún no fue cobrado
    -- Solo cancelar el pedido, no hay dinero que devolver
    v_flow          := 'cancel_only_no_transaction';
    v_credit_amount := 0;

  ELSIF tx_rec.billing_status != 'sent' THEN
    -- Hay transacción pero todavía no fue enviada a SUNAT
    -- (billing_status = 'pending', 'processing', 'excluded', 'error')
    -- El dinero fue cobrado pero la boleta no existe aún.
    -- Solo cancelar; el admin deberá gestionar el reembolso manualmente.
    v_flow          := 'cancel_only_not_sent';
    v_credit_amount := 0;

  ELSE
    -- ✅ CASO PRINCIPAL: hay transacción CON billing_status='sent'
    -- El dinero fue cobrado Y boleteado a SUNAT.
    -- → Acreditar en la billetera interna.
    v_flow          := 'cancel_with_wallet_credit';
    v_credit_amount := lo_rec.effective_price;

    -- Si por algún bug el precio es 0, no acreditar nada
    IF v_credit_amount <= 0 THEN
      v_flow          := 'cancel_only_zero_price';
      v_credit_amount := 0;
    END IF;

    -- Si es pedido de docente (no tiene wallet), degradar
    IF lo_rec.student_id IS NULL THEN
      v_flow          := 'cancel_only_teacher_order';
      v_credit_amount := 0;
    END IF;
  END IF;


  -- ── PASO 4: CANCELAR EL PEDIDO ───────────────────────────────────────────────
  UPDATE lunch_orders
  SET
    status       = 'cancelled',
    is_cancelled = true
  WHERE id = p_lunch_order_id;


  -- ── PASO 5: ACREDITAR BILLETERA (solo si corresponde) ────────────────────────
  IF v_flow = 'cancel_with_wallet_credit' THEN

    -- 5a. Registrar el movimiento en el libro mayor de la billetera
    INSERT INTO wallet_transactions (
      student_id,
      school_id,
      amount,
      type,
      origin_transaction_id,
      origin_lunch_order_id,
      description,
      created_by
    ) VALUES (
      lo_rec.student_id,
      COALESCE(lo_rec.school_id, tx_rec.school_id),
      v_credit_amount,                         -- positivo = crédito
      'cancellation_credit',
      tx_rec.id,                               -- la boleta de SUNAT que lo originó
      p_lunch_order_id,                        -- el almuerzo anulado
      'Anulación: ' ||
        COALESCE(lo_rec.category_name, 'Almuerzo') ||
        ' del ' || to_char(lo_rec.order_date::date, 'DD/MM/YYYY') ||
        COALESCE(' — ' || p_reason, ''),
      v_caller_id
    )
    RETURNING id INTO v_wallet_tx_id;

    -- 5b. Actualizar el saldo en caché de la billetera (atómico)
    v_new_wallet_bal := adjust_student_wallet_balance(
      lo_rec.student_id,
      v_credit_amount   -- +positivo = acreditar
    );

  END IF;


  -- ── PASO 6: AUDITORÍA ────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      v_caller_id,
      'ANULACION_ALMUERZO',
      'COBRANZAS',
      jsonb_build_object(
        'lunch_order_id',       p_lunch_order_id,
        'reason',               p_reason,
        'flow',                 v_flow,
        'credit_amount',        v_credit_amount,
        'origin_tx_id',         tx_rec.id,
        'origin_tx_billing',    tx_rec.billing_status,
        'wallet_tx_id',         v_wallet_tx_id,
        'new_wallet_balance',   v_new_wallet_bal,
        'student_id',           lo_rec.student_id,
        'student_name',         lo_rec.student_name,
        'order_date',           lo_rec.order_date,
        'category',             lo_rec.category_name
      ),
      lo_rec.school_id,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- No revertir la anulación si solo falla el log
    RAISE WARNING 'AUDIT_LOG_FAILED en cancel_lunch_order: %', SQLERRM;
  END;


  -- ── RESULTADO ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',              true,
    'flow',                 v_flow,
    'lunch_order_id',       p_lunch_order_id,
    'wallet_credit_amount', v_credit_amount,
    'new_wallet_balance',   COALESCE(v_new_wallet_bal, NULL),
    'wallet_tx_id',         v_wallet_tx_id,
    -- Mensajes legibles para el frontend:
    'message', CASE v_flow
      WHEN 'cancel_with_wallet_credit'
        THEN 'Almuerzo anulado. S/ ' || v_credit_amount ||
             ' acreditados en la billetera del alumno.'
      WHEN 'cancel_only_not_sent'
        THEN 'Almuerzo anulado. El cobro aún no fue boleteado a SUNAT. ' ||
             'Gestiona el reembolso manualmente.'
      WHEN 'cancel_only_no_transaction'
        THEN 'Almuerzo anulado. No tenía cobro asociado.'
      WHEN 'cancel_only_teacher_order'
        THEN 'Almuerzo de docente anulado. No aplica billetera.'
      WHEN 'cancel_only_zero_price'
        THEN 'Almuerzo anulado. No se pudo determinar el precio para acreditar.'
      ELSE 'Almuerzo anulado.'
    END
  );

EXCEPTION WHEN OTHERS THEN
  -- Re-lanzar para que Postgres haga ROLLBACK de todo
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_lunch_order_with_wallet_credit(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION cancel_lunch_order_with_wallet_credit IS
  'Anula un almuerzo. Si tenía billing_status=sent (boleta SUNAT ya emitida), '
  'acredita el monto en wallet_transactions y actualiza students.wallet_balance. '
  'Si no tenía boleta, solo cancela el pedido. '
  'La transacción fiscal NUNCA se modifica (protegida por trigger).';


-- ═══════════════════════════════════════════════════════════════════════════════
-- SCRIPTS DE PRUEBA
-- Ejecutar en Supabase SQL Editor para verificar el comportamiento completo.
-- ═══════════════════════════════════════════════════════════════════════════════

/*

-- ── PREPARACIÓN: Datos mínimos para las pruebas ──────────────────────────────

-- 1. Obtener un alumno real de tu BD para las pruebas:
SELECT id, full_name, wallet_balance, school_id
FROM students
WHERE is_active = true
LIMIT 5;
-- Anotar: STUDENT_UUID, SCHOOL_UUID

-- 2. Crear un almuerzo de prueba SIN transacción (caso simple):
INSERT INTO lunch_orders (student_id, school_id, order_date, status, is_cancelled, quantity)
VALUES ('STUDENT_UUID', 'SCHOOL_UUID', CURRENT_DATE, 'confirmed', false, 1)
RETURNING id;
-- Anotar: ORDER_NO_TX_UUID

-- 3. Crear un almuerzo de prueba CON transacción 'sent':
INSERT INTO lunch_orders (student_id, school_id, order_date, status, is_cancelled, quantity)
VALUES ('STUDENT_UUID', 'SCHOOL_UUID', CURRENT_DATE, 'confirmed', false, 1)
RETURNING id;
-- Anotar: ORDER_WITH_TX_UUID

-- Crear la transacción vinculada (simular almuerzo cobrado y boleteado):
INSERT INTO transactions (
  type, amount, payment_status, payment_method,
  school_id, student_id, billing_status, is_taxable, is_deleted,
  metadata
) VALUES (
  'purchase', 15.00, 'paid', 'yape',
  'SCHOOL_UUID', 'STUDENT_UUID',
  'sent',          -- ← clave: ya fue a SUNAT
  true, false,
  jsonb_build_object('lunch_order_id', 'ORDER_WITH_TX_UUID')
)
RETURNING id;
-- Anotar: TX_SENT_UUID


-- ── TEST A: Anular almuerzo SIN transacción (debe cancelar sin wallet) ────────
-- Resultado esperado:
--   flow = 'cancel_only_no_transaction'
--   wallet_credit_amount = 0
--   lunch_orders.status = 'cancelled'

SELECT cancel_lunch_order_with_wallet_credit(
  'ORDER_NO_TX_UUID',
  'Prueba de anulación sin cobro previo'
);

-- Verificar:
SELECT id, status, is_cancelled
FROM lunch_orders WHERE id = 'ORDER_NO_TX_UUID';
-- Esperar: status='cancelled', is_cancelled=true


-- ── TEST B: Anular almuerzo CON transacción 'sent' (debe acreditar wallet) ───
-- Resultado esperado:
--   flow = 'cancel_with_wallet_credit'
--   wallet_credit_amount = 15.00
--   students.wallet_balance sube de 0 a 15

-- Saldo inicial (debe ser 0):
SELECT wallet_balance FROM students WHERE id = 'STUDENT_UUID';

SELECT cancel_lunch_order_with_wallet_credit(
  'ORDER_WITH_TX_UUID',
  'Prueba de anulación con boleta SUNAT'
);

-- Verificar saldo subió a 15:
SELECT wallet_balance FROM students WHERE id = 'STUDENT_UUID';
-- Esperado: 15.00

-- Verificar que wallet_transactions registró el movimiento:
SELECT id, amount, type, origin_transaction_id, origin_lunch_order_id, description
FROM wallet_transactions
WHERE student_id = 'STUDENT_UUID'
ORDER BY created_at DESC
LIMIT 3;
-- Esperado: 1 fila, amount=15.00, type='cancellation_credit'

-- Verificar que la transacción fiscal NO fue modificada (el escudo la protege):
SELECT id, billing_status, payment_status
FROM transactions WHERE id = 'TX_SENT_UUID';
-- Esperado: billing_status='sent' (sin cambios — el trigger la protegió)


-- ── TEST C: Intentar anular el mismo pedido dos veces ─────────────────────────
-- Resultado esperado: ERROR 'ALREADY_CANCELLED'

SELECT cancel_lunch_order_with_wallet_credit(
  'ORDER_WITH_TX_UUID',
  'Intento de doble anulación'
);
-- Debe lanzar: ALREADY_CANCELLED: El pedido ... ya está anulado


-- ── TEST D: Verificar auditoría en huella_digital_logs ───────────────────────
SELECT
  accion,
  contexto->>'flow'           AS flujo,
  contexto->>'credit_amount'  AS monto_acreditado,
  contexto->>'student_name'   AS alumno,
  contexto->>'reason'         AS motivo,
  creado_at
FROM huella_digital_logs
WHERE accion = 'ANULACION_ALMUERZO'
ORDER BY creado_at DESC
LIMIT 5;


-- ── LIMPIEZA de datos de prueba ───────────────────────────────────────────────
-- (Solo si usaste UUIDs reales — no ejecutar en producción)

-- Restaurar wallet_balance:
-- UPDATE students SET wallet_balance = 0 WHERE id = 'STUDENT_UUID';

-- Borrar wallet_transactions de prueba:
-- DELETE FROM wallet_transactions WHERE student_id = 'STUDENT_UUID'
--   AND origin_lunch_order_id IN ('ORDER_WITH_TX_UUID');

-- Borrar lunch_orders de prueba:
-- Necesitas deshabilitar el trigger primero para poder borrar
-- transacciones con billing_status='sent':
-- ALTER TABLE transactions DISABLE TRIGGER trg_protect_sent_transactions;
-- DELETE FROM transactions WHERE id = 'TX_SENT_UUID';
-- ALTER TABLE transactions ENABLE TRIGGER trg_protect_sent_transactions;
-- DELETE FROM lunch_orders WHERE id IN ('ORDER_NO_TX_UUID', 'ORDER_WITH_TX_UUID');

*/
