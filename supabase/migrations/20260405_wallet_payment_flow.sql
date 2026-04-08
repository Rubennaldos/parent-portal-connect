-- ============================================================
-- FLUJO DE PAGO CON BILLETERA INTERNA
-- Pasos 4 y 5 de la hoja de ruta
-- ============================================================
-- Parte 1: Columna wallet_amount en recharge_requests
--   El padre registra cuánto quiere usar de su billetera.
--   El resto (amount) es lo que sube como voucher bancario.
--
-- Parte 2: RPC submit_voucher_with_split
--   El padre "inicia" el pago: bloquea el wallet y valida deudas.
--   Crea el recharge_request con wallet_amount almacenado.
--
-- Parte 3: RPC approve_split_payment_voucher
--   El admin aprueba el voucher. Dentro de una sola transacción:
--     A) Marca deudas originales como paid / billing_status='excluded'
--     B) Debita wallet_balance y registra en wallet_transactions
--     C) Crea UNA nueva transacción fiscal por el monto real del voucher
--     D) Marca lunch_orders como delivered
--     E) Cierra el recharge_request como 'approved'
--   El frontend solo llama a Nubefact para la transacción fiscal (C).
-- ============================================================


-- ════════════════════════════════════════════════════════════════
-- PARTE 1: Columna wallet_amount en recharge_requests
-- ════════════════════════════════════════════════════════════════

ALTER TABLE recharge_requests
  ADD COLUMN IF NOT EXISTS wallet_amount NUMERIC(10,2) NOT NULL DEFAULT 0
  CHECK (wallet_amount >= 0);

COMMENT ON COLUMN recharge_requests.wallet_amount IS
  'Monto que se descuenta de la billetera interna del alumno. '
  'El campo amount contiene el monto real del voucher bancario. '
  'Deuda total = wallet_amount + amount. '
  'Cuando es 0 es un pago tradicional sin billetera.';


-- ════════════════════════════════════════════════════════════════
-- PARTE 2: RPC submit_voucher_with_split
-- ════════════════════════════════════════════════════════════════
-- Llamado por el padre desde el Portal al confirmar el pago.
-- Valida saldo, bloquea las deudas y registra la intención de pago.
-- NO ejecuta cobros todavía — eso lo hace el admin al aprobar.

DROP FUNCTION IF EXISTS submit_voucher_with_split(
  uuid, uuid[], uuid[], numeric, numeric, text, text, text, jsonb
);

CREATE OR REPLACE FUNCTION submit_voucher_with_split(
  p_student_id         uuid,
  p_debt_tx_ids        uuid[]   DEFAULT '{}',
  p_lunch_order_ids    uuid[]   DEFAULT '{}',
  p_wallet_amount      numeric  DEFAULT 0,    -- monto de la billetera
  p_voucher_amount     numeric  DEFAULT 0,    -- monto del voucher bancario
  p_voucher_url        text     DEFAULT NULL, -- URL subida a Storage
  p_reference_code     text     DEFAULT NULL, -- nro. de operación si lo saben
  p_invoice_type       text     DEFAULT NULL, -- 'boleta' | 'factura' | null
  p_invoice_client_data jsonb   DEFAULT NULL  -- datos de DNI/RUC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_student        record;
  v_school_id      uuid;
  v_request_id     uuid;
  v_total_debt     numeric;
BEGIN
  -- ── AUTENTICACIÓN ─────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  -- ── VALIDAR QUE EL ALUMNO PERTENECE A ESTE PADRE ──────────────────────────
  SELECT id, wallet_balance, school_id, full_name
  INTO   v_student
  FROM   students
  WHERE  id = p_student_id
    AND  parent_id = v_caller_id
    AND  is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: El alumno no pertenece a este padre';
  END IF;

  v_school_id := v_student.school_id;

  -- ── VALIDAR SALDO DE BILLETERA ─────────────────────────────────────────────
  IF p_wallet_amount > 0 AND v_student.wallet_balance < p_wallet_amount THEN
    RAISE EXCEPTION
      'INSUFFICIENT_WALLET: Saldo insuficiente. '
      'Disponible: S/ %, solicitado: S/ %',
      v_student.wallet_balance, p_wallet_amount;
  END IF;

  -- ── VALIDAR MONTOS ─────────────────────────────────────────────────────────
  IF p_voucher_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: El monto del voucher no puede ser negativo';
  END IF;

  -- Al menos uno de los dos montos debe ser > 0
  IF p_wallet_amount <= 0 AND p_voucher_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNTS: Ambos montos son 0. Nada que pagar.';
  END IF;

  -- ── VALIDAR QUE LAS DEUDAS EXISTEN Y PERTENECEN AL ALUMNO ─────────────────
  IF array_length(p_debt_tx_ids, 1) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM transactions
      WHERE id = ANY(p_debt_tx_ids)
        AND (student_id != p_student_id OR payment_status NOT IN ('pending', 'partial'))
    ) THEN
      RAISE EXCEPTION
        'INVALID_DEBTS: Algunas transacciones no pertenecen al alumno '
        'o ya no están pendientes';
    END IF;
  END IF;

  -- ── CREAR EL RECHARGE_REQUEST ──────────────────────────────────────────────
  -- wallet_amount: lo que se descuenta de la billetera
  -- amount:        lo que el padre paga con voucher bancario
  INSERT INTO recharge_requests (
    student_id,
    parent_id,
    school_id,
    amount,                    -- = p_voucher_amount (monto del voucher)
    wallet_amount,             -- = p_wallet_amount  (monto de billetera)
    payment_method,
    reference_code,
    voucher_url,
    status,
    request_type,
    description,
    paid_transaction_ids,
    lunch_order_ids,
    invoice_type,              -- columna directa para que VoucherApproval lo lea sin parsear JSON
    invoice_client_data        -- ídem
  ) VALUES (
    p_student_id,
    v_caller_id,
    v_school_id,
    p_voucher_amount,
    p_wallet_amount,
    'transferencia',           -- se actualizará con la pasarela real en el futuro
    p_reference_code,
    p_voucher_url,
    'pending',
    'debt_payment',
    CASE
      WHEN p_wallet_amount > 0
        THEN 'Pago dividido: S/ ' || p_wallet_amount ||
             ' de billetera + S/ ' || p_voucher_amount || ' de voucher'
      ELSE 'Pago de deuda pendiente'
    END,
    CASE WHEN array_length(p_debt_tx_ids, 1) > 0 THEN p_debt_tx_ids ELSE NULL END,
    CASE WHEN array_length(p_lunch_order_ids, 1) > 0 THEN p_lunch_order_ids ELSE NULL END,
    p_invoice_type,
    p_invoice_client_data
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'success',         true,
    'request_id',      v_request_id,
    'wallet_amount',   p_wallet_amount,
    'voucher_amount',  p_voucher_amount,
    'message',
      CASE WHEN p_wallet_amount > 0
        THEN 'Pago registrado. S/ ' || p_wallet_amount ||
             ' de billetera + S/ ' || p_voucher_amount || ' de voucher. ' ||
             'El administrador verificará el comprobante.'
        ELSE 'Voucher enviado correctamente. El administrador lo verificará.'
      END
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_voucher_with_split(
  uuid, uuid[], uuid[], numeric, numeric, text, text, text, jsonb
) TO authenticated;

COMMENT ON FUNCTION submit_voucher_with_split IS
  'Registra la intención de pago del padre con pago dividido (billetera + voucher). '
  'Valida que el alumno pertenezca al padre y que tenga saldo suficiente. '
  'NO ejecuta el cobro — eso lo hace approve_split_payment_voucher cuando el admin aprueba.';


-- ════════════════════════════════════════════════════════════════
-- PARTE 3: RPC approve_split_payment_voucher
-- ════════════════════════════════════════════════════════════════
-- El paso crítico y atómico. El admin aprueba el voucher y
-- el sistema ejecuta TODOS los efectos en una sola transacción.
-- Si cualquier paso falla → ROLLBACK total.
--
-- Efectos en orden:
--   1. Bloqueo pesimista (FOR UPDATE) sobre todas las filas relevantes
--   2. Validación post-lock (deudas siguen pendientes, wallet suficiente)
--   3. Marca deudas originales como pagadas
--      → billing_status='excluded' si hay wallet (el monto no coincide)
--      → billing_status no cambia si es pago completo sin wallet
--   4. Si wallet_amount > 0: debita billetera + registra en wallet_transactions
--   5. Crea nueva transacción FISCAL por el monto del voucher
--      (esta es la que va a Nubefact — coincide con lo que entró al banco)
--   6. Marca lunch_orders como delivered (si los hay)
--   7. Cierra el recharge_request como 'approved'
--   8. Audit log
--
-- Retorna: { success, fiscal_tx_id, wallet_tx_id, wallet_amount_used,
--            fiscal_amount, message }
-- El frontend llama a generate-document SOLO con fiscal_tx_id.

DROP FUNCTION IF EXISTS approve_split_payment_voucher(uuid, text, text);

CREATE OR REPLACE FUNCTION approve_split_payment_voucher(
  p_request_id       uuid,
  p_operation_number text     DEFAULT NULL,  -- nro. de operación del banco
  p_admin_notes      text     DEFAULT NULL   -- notas del admin al aprobar
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_caller_role    text;
  req              record;   -- el recharge_request
  v_wallet_amount  numeric;
  v_fiscal_amount  numeric;
  v_fiscal_tx_id   uuid;
  v_wallet_tx_id   uuid;
  v_ticket_base    text;
  v_student        record;
BEGIN
  -- ── AUTENTICACIÓN Y ROL ───────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN (
    'admin_general', 'gestor_unidad', 'cajero', 'operador_caja',
    'supervisor_red', 'superadmin'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Solo administradores pueden aprobar pagos';
  END IF;


  -- ── PASO 1: BLOQUEAR EL RECHARGE_REQUEST (solo si está pendiente) ─────────
  SELECT *
  INTO   req
  FROM   recharge_requests
  WHERE  id     = p_request_id
    AND  status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'ALREADY_PROCESSED: El comprobante ya fue aprobado o rechazado por otro administrador';
  END IF;

  v_wallet_amount := COALESCE(req.wallet_amount, 0);
  v_fiscal_amount := req.amount;   -- monto del voucher bancario


  -- ── PASO 2: BLOQUEAR DEUDAS Y VALIDAR QUE SIGUEN PENDIENTES ─────────────
  IF req.paid_transaction_ids IS NOT NULL AND
     array_length(req.paid_transaction_ids, 1) > 0 THEN

    PERFORM id
    FROM    transactions
    WHERE   id = ANY(req.paid_transaction_ids::uuid[])
    FOR UPDATE;

    -- Post-lock: verificar que ninguna fue cobrada por otro proceso
    IF EXISTS (
      SELECT 1 FROM transactions
      WHERE  id = ANY(req.paid_transaction_ids::uuid[])
        AND  payment_status NOT IN ('pending', 'partial')
    ) THEN
      RAISE EXCEPTION
        'CONFLICT: Algunas deudas ya fueron cobradas por otro proceso. '
        'Recarga la lista e intenta de nuevo.';
    END IF;
  END IF;


  -- ── PASO 3: VALIDAR SALDO DE BILLETERA (post-lock, valor fresco) ─────────
  IF v_wallet_amount > 0 THEN
    SELECT *
    INTO   v_student
    FROM   students
    WHERE  id = req.student_id
    FOR UPDATE;

    IF v_student.wallet_balance < v_wallet_amount THEN
      RAISE EXCEPTION
        'INSUFFICIENT_WALLET: El saldo de la billetera bajó entre el envío y la aprobación. '
        'Saldo actual: S/ %, requerido: S/ %',
        v_student.wallet_balance, v_wallet_amount;
    END IF;
  END IF;


  -- ── PASO 4: CERRAR EL RECHARGE_REQUEST COMO APROBADO ────────────────────
  -- Hacemos esto PRIMERO como "candado de segunda capa" (si dos admins llegan
  -- al mismo tiempo, el UPDATE con WHERE status='pending' garantiza que solo
  -- uno avanza).
  UPDATE recharge_requests
  SET
    status      = 'approved',
    approved_by = v_caller_id,
    approved_at = now(),
    notes       = COALESCE(p_admin_notes, notes)
  WHERE id     = p_request_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'RACE_CONDITION: Otro administrador aprobó este voucher en el mismo instante';
  END IF;


  -- ── PASO 5: MARCAR DEUDAS ORIGINALES COMO PAGADAS ────────────────────────
  -- billing_status:
  --   Si hay wallet → 'excluded' (el monto de las deudas originales ≠ monto fiscal)
  --   Si no hay wallet → 'pending' (sigue el flujo normal a Nubefact)
  IF req.paid_transaction_ids IS NOT NULL AND
     array_length(req.paid_transaction_ids, 1) > 0 THEN

    UPDATE transactions
    SET
      payment_status   = 'paid',
      payment_method   = CASE WHEN v_wallet_amount > 0 THEN 'mixto' ELSE 'voucher' END,
      operation_number = p_operation_number,
      billing_status   = CASE WHEN v_wallet_amount > 0 THEN 'excluded' ELSE billing_status END,
      created_by       = v_caller_id
    WHERE id = ANY(req.paid_transaction_ids::uuid[])
      AND payment_status IN ('pending', 'partial');

  END IF;


  -- ── PASO 6: DÉBITO DE BILLETERA (solo si hay wallet_amount) ─────────────
  IF v_wallet_amount > 0 THEN

    INSERT INTO wallet_transactions (
      student_id,
      school_id,
      amount,
      type,
      applied_to_session_id,
      description,
      created_by
    ) VALUES (
      req.student_id,
      req.school_id,
      -v_wallet_amount,    -- negativo = débito
      'payment_debit',
      NULL,                -- no usamos payment_sessions en el flujo de voucher
      'Pago de deuda — billetera usada en voucher #' ||
        COALESCE(p_operation_number, req.id::text),
      v_caller_id
    )
    RETURNING id INTO v_wallet_tx_id;

    -- Actualizar el saldo en caché (atómico)
    PERFORM adjust_student_wallet_balance(req.student_id, -v_wallet_amount);

  END IF;


  -- ── PASO 7: CREAR TRANSACCIÓN FISCAL POR EL MONTO DEL VOUCHER ────────────
  -- Esta es la transacción que va a Nubefact.
  -- Monto = lo que realmente entró al banco del colegio.
  -- billing_status = 'pending' → el frontend la envía a generate-document.
  IF v_fiscal_amount > 0 THEN

    -- Intentar obtener un ticket correlativo
    BEGIN
      SELECT get_next_ticket_number(v_caller_id) INTO v_ticket_base;
    EXCEPTION WHEN OTHERS THEN
      v_ticket_base := 'COB-' || to_char(now(), 'YYYYMMDD-HH24MISS');
    END;

    INSERT INTO transactions (
      type,
      amount,
      payment_status,
      payment_method,
      operation_number,
      description,
      student_id,
      school_id,
      created_by,
      is_taxable,
      billing_status,
      ticket_code,
      metadata
    ) VALUES (
      'purchase',
      v_fiscal_amount,
      'paid',
      'voucher',
      p_operation_number,
      COALESCE(
        req.description,
        'Pago de deuda — voucher aprobado'
      ),
      req.student_id,
      req.school_id,
      v_caller_id,
      true,                -- is_taxable: va a Nubefact
      'pending',           -- billing_status: listo para generar boleta
      v_ticket_base,
      jsonb_build_object(
        'recharge_request_id',  p_request_id,
        'wallet_amount_used',   v_wallet_amount,
        'is_split_payment',     v_wallet_amount > 0,
        'wallet_tx_id',         v_wallet_tx_id,
        'original_debt_ids',    req.paid_transaction_ids,
        'original_lunch_ids',   req.lunch_order_ids,
        'source',               'split_voucher_approval'
      )
    )
    RETURNING id INTO v_fiscal_tx_id;

  END IF;


  -- ── PASO 8: MARCAR LUNCH_ORDERS COMO DELIVERED ───────────────────────────
  IF req.lunch_order_ids IS NOT NULL AND
     array_length(req.lunch_order_ids, 1) > 0 THEN

    UPDATE lunch_orders
    SET
      status       = 'delivered',
      delivered_at = now()
    WHERE id     = ANY(req.lunch_order_ids)
      AND status NOT IN ('delivered', 'cancelled');

  END IF;


  -- ── PASO 9: AUDIT LOG ────────────────────────────────────────────────────
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
      'APROBACION_PAGO_DIVIDIDO',
      'COBRANZAS',
      jsonb_build_object(
        'request_id',         p_request_id,
        'student_id',         req.student_id,
        'wallet_amount',      v_wallet_amount,
        'fiscal_amount',      v_fiscal_amount,
        'fiscal_tx_id',       v_fiscal_tx_id,
        'wallet_tx_id',       v_wallet_tx_id,
        'operation_number',   p_operation_number,
        'debt_tx_ids',        req.paid_transaction_ids,
        'lunch_order_ids',    req.lunch_order_ids,
        'admin_notes',        p_admin_notes
      ),
      req.school_id,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'AUDIT_LOG_FAILED en approve_split_payment_voucher: %', SQLERRM;
  END;


  -- ── RESULTADO ─────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',              true,
    'fiscal_tx_id',         v_fiscal_tx_id,
    'wallet_tx_id',         v_wallet_tx_id,
    'wallet_amount_used',   v_wallet_amount,
    'fiscal_amount',        v_fiscal_amount,
    -- El frontend usa fiscal_tx_id para llamar a generate-document
    -- SOLO si fiscal_amount > 0
    'should_invoice',       v_fiscal_amount > 0,
    'message',
      CASE
        WHEN v_wallet_amount > 0 AND v_fiscal_amount > 0
          THEN 'Pago aprobado. S/ ' || v_wallet_amount ||
               ' descontados de la billetera + S/ ' || v_fiscal_amount ||
               ' del voucher. Boleta por S/ ' || v_fiscal_amount || ' generada.'
        WHEN v_wallet_amount > 0 AND v_fiscal_amount = 0
          THEN 'Pago aprobado con saldo a favor completo. No se emite boleta.'
        ELSE
          'Pago aprobado con voucher. Boleta por S/ ' || v_fiscal_amount || ' generada.'
      END
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_split_payment_voucher(uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION approve_split_payment_voucher IS
  'Aprobación atómica de voucher con pago dividido (billetera + voucher). '
  'Marca deudas originales como excluidas de Nubefact, debita billetera, '
  'crea una transacción fiscal solo por el monto del voucher. '
  'El frontend llama a generate-document con fiscal_tx_id si should_invoice=true.';


-- ════════════════════════════════════════════════════════════════
-- PARTE 4: RPC pay_debt_with_wallet_only
-- ════════════════════════════════════════════════════════════════
-- Para el caso en que el saldo a favor del alumno cubre el 100%
-- de la deuda. No se sube voucher, no se crea recharge_request,
-- no se genera boleta a SUNAT (billing_status='excluded').
-- El padre hace clic en "Pagar con Saldo a Favor" → modal cierra.
--
-- Llamado directamente desde RechargeModal.tsx (no desde VoucherApproval).
-- Efectos en una sola transacción:
--   1. Valida que el alumno pertenezca al padre (auth.uid)
--   2. Bloquea alumno y transacciones FOR UPDATE
--   3. Recalcula la deuda real en BD (no confía en el cliente)
--   4. Valida wallet_balance >= deuda real
--   5. Marca deudas como paid / billing_status='excluded'
--   6. Debita wallet + registra en wallet_transactions
--   7. Marca lunch_orders como delivered (si los hay)
--   8. Audit log

DROP FUNCTION IF EXISTS pay_debt_with_wallet_only(uuid, uuid[], uuid[]);

CREATE OR REPLACE FUNCTION pay_debt_with_wallet_only(
  p_student_id      uuid,
  p_debt_tx_ids     uuid[]   DEFAULT '{}',
  p_lunch_order_ids uuid[]   DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid;
  v_student      record;
  v_total_debt   numeric;
  v_wallet_tx_id uuid;
BEGIN
  -- ── AUTENTICACIÓN ─────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  -- ── VALIDAR QUE EL ALUMNO PERTENECE A ESTE PADRE ──────────────────────────
  -- Bloqueo pesimista inmediato: nadie más puede modificar el alumno durante
  -- esta transacción.
  SELECT *
  INTO   v_student
  FROM   students
  WHERE  id        = p_student_id
    AND  parent_id = v_caller_id
    AND  is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: El alumno no pertenece a este padre';
  END IF;

  -- ── BLOQUEAR LAS TRANSACCIONES DE DEUDA ───────────────────────────────────
  IF array_length(p_debt_tx_ids, 1) > 0 THEN
    PERFORM id
    FROM    transactions
    WHERE   id = ANY(p_debt_tx_ids)
    FOR UPDATE;
  END IF;

  -- ── RECALCULAR LA DEUDA REAL (nunca confiar en el cliente) ────────────────
  SELECT COALESCE(SUM(amount), 0)
  INTO   v_total_debt
  FROM   transactions
  WHERE  id             = ANY(p_debt_tx_ids)
    AND  payment_status IN ('pending', 'partial');

  IF v_total_debt <= 0 THEN
    RAISE EXCEPTION
      'NO_DEBT: No hay deudas pendientes en los IDs proporcionados';
  END IF;

  -- ── VALIDAR QUE EL SALDO CUBRE LA DEUDA TOTAL ─────────────────────────────
  IF v_student.wallet_balance < v_total_debt THEN
    RAISE EXCEPTION
      'INSUFFICIENT_WALLET: Saldo insuficiente. '
      'Disponible: S/ %, deuda total: S/ %',
      v_student.wallet_balance, v_total_debt;
  END IF;

  -- ── POST-LOCK: Verificar que las deudas siguen pendientes ─────────────────
  IF EXISTS (
    SELECT 1 FROM transactions
    WHERE  id = ANY(p_debt_tx_ids)
      AND  payment_status NOT IN ('pending', 'partial')
  ) THEN
    RAISE EXCEPTION
      'CONFLICT: Algunas deudas ya fueron cobradas por otro proceso. '
      'Recarga la lista e intenta de nuevo.';
  END IF;

  -- ── MARCAR DEUDAS COMO PAGADAS ────────────────────────────────────────────
  -- billing_status='excluded': nada va a Nubefact.
  -- El dinero era billetera interna, ya fue boleteado en su origen.
  UPDATE transactions
  SET
    payment_status = 'paid',
    billing_status = 'excluded',
    payment_method = 'wallet_balance',
    created_by     = v_caller_id
  WHERE id = ANY(p_debt_tx_ids)
    AND payment_status IN ('pending', 'partial');

  -- ── DÉBITO DE BILLETERA ───────────────────────────────────────────────────
  INSERT INTO wallet_transactions (
    student_id,
    school_id,
    amount,
    type,
    description,
    created_by
  ) VALUES (
    p_student_id,
    v_student.school_id,
    -v_total_debt,   -- negativo = débito
    'payment_debit',
    'Pago de deuda 100% con saldo a favor — S/ ' || v_total_debt,
    v_caller_id
  )
  RETURNING id INTO v_wallet_tx_id;

  -- Actualizar saldo (función atómica reutilizada)
  PERFORM adjust_student_wallet_balance(p_student_id, -v_total_debt);

  -- ── MARCAR LUNCH_ORDERS COMO DELIVERED ───────────────────────────────────
  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    UPDATE lunch_orders
    SET
      status       = 'delivered',
      delivered_at = now()
    WHERE id     = ANY(p_lunch_order_ids)
      AND status NOT IN ('delivered', 'cancelled');
  END IF;

  -- ── AUDIT LOG ────────────────────────────────────────────────────────────
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
      'PAGO_COMPLETO_BILLETERA',
      'PORTAL_PADRES',
      jsonb_build_object(
        'student_id',      p_student_id,
        'debt_tx_ids',     p_debt_tx_ids,
        'lunch_order_ids', p_lunch_order_ids,
        'wallet_used',     v_total_debt,
        'wallet_tx_id',    v_wallet_tx_id
      ),
      v_student.school_id,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'AUDIT_LOG_FAILED en pay_debt_with_wallet_only: %', SQLERRM;
  END;

  -- ── RESULTADO ─────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',           true,
    'wallet_amount_used', v_total_debt,
    'wallet_tx_id',      v_wallet_tx_id,
    'debts_cleared',     array_length(p_debt_tx_ids, 1),
    'message',
      'Pago completado. S/ ' || v_total_debt ||
      ' descontados de tu saldo a favor. No se emite boleta.'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION pay_debt_with_wallet_only(uuid, uuid[], uuid[])
  TO authenticated;

COMMENT ON FUNCTION pay_debt_with_wallet_only IS
  'Pago de deuda 100% con billetera interna. Sin voucher, sin boleta SUNAT. '
  'Llamado directamente desde el Portal del Padre cuando el saldo cubre toda la deuda. '
  'Atómico: bloquea alumno y transacciones con FOR UPDATE, recalcula deuda real en BD, '
  'valida saldo y ejecuta todo en una sola transacción de base de datos.';
