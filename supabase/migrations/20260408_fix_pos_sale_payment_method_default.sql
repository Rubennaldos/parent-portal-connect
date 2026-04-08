-- ============================================================
-- FIX: complete_pos_sale_v2 — eliminar DEFAULT 'efectivo'
--
-- BUG: p_payment_method tenía DEFAULT 'efectivo', lo que hacía
-- que cualquier venta de alumno/profesor (donde el frontend
-- enviaba NULL) quedara clasificada como efectivo en la BD.
-- Esto inflaba el total de efectivo en el cierre de caja.
--
-- SOLUCIÓN: Cambiar DEFAULT a NULL.
-- El RPC ya resuelve correctamente el método por p_client_mode:
--   student + balance  → 'saldo'
--   student + free     → NULL (deuda)
--   teacher            → NULL
--   generic            → COALESCE(p_payment_method, 'efectivo')
-- ============================================================

CREATE OR REPLACE FUNCTION complete_pos_sale_v2(
  p_school_id        uuid,
  p_cashier_id       uuid,
  p_lines            jsonb,
  p_client_mode      text,
  p_student_id       uuid    DEFAULT NULL,
  p_teacher_id       uuid    DEFAULT NULL,
  p_payment_method   text    DEFAULT NULL,   -- ← era DEFAULT 'efectivo'
  p_payment_metadata jsonb   DEFAULT '{}',
  p_billing_data     jsonb   DEFAULT '{}',
  p_idempotency_key  text    DEFAULT NULL,
  p_cash_given       numeric DEFAULT NULL,
  p_payment_splits   jsonb   DEFAULT '[]',
  p_cash_session_id  uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- iteración de líneas
  v_elem          jsonb;
  v_line_items    jsonb := '[]'::jsonb;
  v_is_custom     boolean;
  v_product_id    uuid;
  v_quantity      numeric;
  v_price         numeric;
  v_subtotal      numeric;
  v_item_obj      jsonb;

  -- totales
  v_total         numeric := 0;
  v_balance_after numeric;

  -- alumno
  v_student_balance numeric;
  v_free_account    boolean;
  v_kiosk_disabled  boolean;
  v_should_use_balance boolean;

  -- topes
  v_limit_type          text;
  v_period_spent        numeric := 0;
  v_daily_limit         numeric;
  v_weekly_limit        numeric;
  v_monthly_limit       numeric;
  v_effective_limit     numeric;
  v_available           numeric;

  -- ticket e idempotencia
  v_ticket_code     text;
  v_transaction_id  uuid;
  v_existing_tx_id  uuid;

  -- pago
  v_eff_method      text;
  v_payment_status  text;
  v_billing_method  text;
  v_doc_type        text;
  v_is_taxable      boolean;
  v_billing_status  text;

  -- pago mixto
  v_is_mixed      boolean;
  v_cash_amount   numeric := 0;
  v_card_amount   numeric := 0;
  v_yape_amount   numeric := 0;

  -- fecha Lima
  v_sale_date     date;

  -- stock
  v_stock_current numeric;
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 0. IDEMPOTENCIA
  -- ────────────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT transaction_id INTO v_existing_tx_id
    FROM pos_idempotency_keys
    WHERE school_id = p_school_id AND idempotency_key = p_idempotency_key;

    IF v_existing_tx_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'ok',             true,
        'transaction_id', v_existing_tx_id,
        'ticket_code',    ticket_code,
        'total',          ABS(amount),
        'balance_after',  balance_after,
        'payment_status', payment_status,
        'duplicate',      true
      )
      FROM transactions WHERE id = v_existing_tx_id
      INTO v_item_obj;
      RETURN v_item_obj;
    END IF;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 1. FECHA DE NEGOCIO EN LIMA
  -- ────────────────────────────────────────────────────────────────
  v_sale_date := (clock_timestamp() AT TIME ZONE 'America/Lima')::date;

  -- ────────────────────────────────────────────────────────────────
  -- 2. VALIDAR Y EXPANDIR LÍNEAS (precios desde BD)
  -- ────────────────────────────────────────────────────────────────
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_lines) AS value LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := (v_elem->>'quantity')::numeric;

    IF v_is_custom THEN
      v_price    := (v_elem->>'custom_price')::numeric;
      v_subtotal := v_price * v_quantity;
      v_item_obj := jsonb_build_object(
        'product_id',   NULL,
        'product_name', v_elem->>'custom_name',
        'quantity',     v_quantity,
        'unit_price',   v_price,
        'subtotal',     v_subtotal,
        'is_custom',    true
      );
    ELSE
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'product_id requerido para líneas no personalizadas';
      END IF;

      -- Precio oficial desde BD (ignora el precio del cliente)
      SELECT price INTO v_price
      FROM products
      WHERE id = v_product_id AND school_id = p_school_id AND is_active = true;

      IF v_price IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado o inactivo: %', v_product_id;
      END IF;

      -- Verificar stock si hay control
      SELECT current_stock INTO v_stock_current
      FROM product_stock
      WHERE product_id = v_product_id AND school_id = p_school_id AND is_enabled = true;

      IF v_stock_current IS NOT NULL AND v_stock_current < v_quantity THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock insuficiente para el producto. Disponible: %, solicitado: %', v_stock_current, v_quantity;
      END IF;

      v_subtotal := v_price * v_quantity;
      v_item_obj := jsonb_build_object(
        'product_id',   v_product_id,
        'product_name', (SELECT name FROM products WHERE id = v_product_id),
        'quantity',     v_quantity,
        'unit_price',   v_price,
        'subtotal',     v_subtotal,
        'is_custom',    false
      );
    END IF;

    v_line_items := v_line_items || jsonb_build_array(v_item_obj);
    v_total      := v_total + v_subtotal;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total de la venta debe ser mayor a 0';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 3. LÓGICA DE ALUMNO
  -- ────────────────────────────────────────────────────────────────
  IF p_client_mode = 'student' THEN
    IF p_student_id IS NULL THEN
      RAISE EXCEPTION 'p_student_id requerido para ventas de alumno';
    END IF;

    SELECT balance, COALESCE(free_account, true), COALESCE(kiosk_disabled, false)
    INTO   v_student_balance, v_free_account, v_kiosk_disabled
    FROM   students
    WHERE  id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Alumno no encontrado: %', p_student_id;
    END IF;

    IF v_kiosk_disabled THEN
      RAISE EXCEPTION 'KIOSK_DISABLED: El kiosco de este alumno está desactivado.';
    END IF;

    -- Topes de consumo
    SELECT limit_type, COALESCE(daily_limit,0), COALESCE(weekly_limit,0), COALESCE(monthly_limit,0),
           COALESCE(current_period_spent,0)
    INTO   v_limit_type, v_daily_limit, v_weekly_limit, v_monthly_limit, v_period_spent
    FROM   students WHERE id = p_student_id;

    IF v_limit_type IS NOT NULL AND v_limit_type <> 'none' THEN
      v_effective_limit := CASE v_limit_type
        WHEN 'daily'   THEN v_daily_limit
        WHEN 'weekly'  THEN v_weekly_limit
        WHEN 'monthly' THEN v_monthly_limit
        ELSE 0
      END;
      v_available := GREATEST(0, v_effective_limit - v_period_spent);
      IF v_effective_limit > 0 AND v_total > v_available THEN
        RAISE EXCEPTION 'SPENDING_LIMIT: Límite de consumo alcanzado. Disponible: S/ %, solicitado: S/ %',
          ROUND(v_available,2), ROUND(v_total,2);
      END IF;
    END IF;

    v_should_use_balance := (v_free_account = false);

    IF v_should_use_balance THEN
      IF v_student_balance < v_total THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Saldo insuficiente. Saldo actual: S/ %, requerido: S/ %',
          ROUND(v_student_balance,2), ROUND(v_total,2);
      END IF;
      UPDATE students SET balance = balance - v_total WHERE id = p_student_id;
      v_balance_after := v_student_balance - v_total;
    ELSE
      v_balance_after := v_student_balance;
    END IF;

    v_payment_status := CASE WHEN v_should_use_balance THEN 'paid' ELSE 'pending' END;
  ELSE
    v_should_use_balance := false;
    v_payment_status     := 'paid';
    v_balance_after      := NULL;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 4. VALIDAR SESIÓN DE CAJA (cajero normal)
  -- ────────────────────────────────────────────────────────────────
  IF p_cash_session_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cash_sessions
      WHERE id = p_cash_session_id AND school_id = p_school_id AND status = 'open'
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece a esta sede.';
    END IF;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 5. ACTUALIZAR current_period_spent
  -- ────────────────────────────────────────────────────────────────
  IF p_client_mode = 'student' AND p_student_id IS NOT NULL THEN
    UPDATE students
    SET current_period_spent = COALESCE(current_period_spent, 0) + v_total
    WHERE id = p_student_id;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 6. CALCULAR FLAGS DE FACTURACIÓN
  -- ────────────────────────────────────────────────────────────────
  v_doc_type := COALESCE(p_billing_data->>'document_type', 'ticket');

  v_billing_method := CASE
    WHEN p_client_mode = 'student' AND v_should_use_balance     THEN 'saldo'
    WHEN p_client_mode = 'student' AND NOT v_should_use_balance THEN 'pagar_luego'
    WHEN p_client_mode = 'teacher'                              THEN 'pagar_luego'
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  v_is_taxable := CASE
    WHEN v_doc_type IN ('boleta', 'factura')                                           THEN true
    WHEN v_billing_method IN ('efectivo','cash','saldo','pagar_luego','adjustment')    THEN false
    ELSE true
  END;

  v_billing_status := CASE WHEN v_is_taxable THEN 'pending' ELSE 'excluded' END;

  -- ────────────────────────────────────────────────────────────────
  -- 7. CAMPOS DE PAGO MIXTO
  -- ────────────────────────────────────────────────────────────────
  v_is_mixed := (p_payment_method = 'mixto'
                 AND p_payment_splits IS NOT NULL
                 AND jsonb_array_length(p_payment_splits) > 0);

  IF v_is_mixed THEN
    SELECT
      COALESCE(SUM((s->>'amount')::numeric) FILTER (WHERE s->>'method' = 'efectivo'), 0),
      COALESCE(SUM((s->>'amount')::numeric) FILTER (WHERE s->>'method' = 'tarjeta'),  0),
      COALESCE(SUM((s->>'amount')::numeric) FILTER (WHERE s->>'method' IN ('yape','transferencia')), 0)
    INTO v_cash_amount, v_card_amount, v_yape_amount
    FROM jsonb_array_elements(p_payment_splits) s;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 8. GENERAR NÚMERO DE TICKET
  -- ────────────────────────────────────────────────────────────────
  SELECT get_next_ticket_number(p_cashier_id) INTO v_ticket_code;

  -- ────────────────────────────────────────────────────────────────
  -- 9. INSERTAR TRANSACCIÓN
  -- ────────────────────────────────────────────────────────────────
  -- Para student/teacher el método de pago lo determina el RPC (no el cliente).
  -- Esto previene que ventas de crédito aparezcan como 'efectivo' en el cierre.
  v_eff_method := CASE
    WHEN p_client_mode = 'student' THEN
      CASE WHEN v_should_use_balance THEN 'saldo' ELSE NULL END
    WHEN p_client_mode = 'teacher' THEN NULL
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  INSERT INTO transactions (
    student_id,   teacher_id,  school_id,
    type,         amount,      description,
    balance_after, created_by, ticket_code,
    payment_status, payment_method, metadata,
    paid_with_mixed, cash_amount, card_amount, yape_amount,
    document_type, invoice_client_name, invoice_client_dni_ruc,
    is_taxable, billing_status,
    created_at
  )
  VALUES (
    CASE WHEN p_client_mode = 'student' THEN p_student_id ELSE NULL END,
    CASE WHEN p_client_mode = 'teacher' THEN p_teacher_id ELSE NULL END,
    p_school_id,
    'purchase',
    -v_total,
    CASE
      WHEN p_client_mode = 'student' AND v_should_use_balance
        THEN 'Compra POS (Saldo) - S/ '                || v_total::text
      WHEN p_client_mode = 'student'
        THEN 'Compra POS (Cuenta Libre - Deuda) - S/ ' || v_total::text
      WHEN p_client_mode = 'teacher'
        THEN 'Compra Profesor - '         || jsonb_array_length(p_lines)::text || ' items'
      ELSE  'Compra Cliente Genérico - '  || jsonb_array_length(p_lines)::text || ' items'
    END,
    v_balance_after,
    p_cashier_id,
    v_ticket_code,
    v_payment_status,
    v_eff_method,
    COALESCE(p_payment_metadata, '{}') || jsonb_build_object('source', 'pos'),
    v_is_mixed,
    v_cash_amount,
    v_card_amount,
    v_yape_amount,
    v_doc_type,
    p_billing_data->>'client_name',
    p_billing_data->>'client_dni_ruc',
    v_is_taxable,
    v_billing_status,
    clock_timestamp()
  )
  RETURNING id INTO v_transaction_id;

  -- ────────────────────────────────────────────────────────────────
  -- 10. INSERTAR TRANSACTION_ITEMS
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO transaction_items (
    transaction_id, product_id,  product_name,
    quantity,       unit_price,  subtotal,
    is_custom_sale
  )
  SELECT
    v_transaction_id,
    (item->>'product_id')::uuid,
    item->>'product_name',
    (item->>'quantity')::numeric,
    (item->>'unit_price')::numeric,
    (item->>'subtotal')::numeric,
    COALESCE((item->>'is_custom')::boolean, false)
  FROM jsonb_array_elements(v_line_items) item;

  -- ────────────────────────────────────────────────────────────────
  -- 11. INSERTAR SALES (módulo Finanzas)
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO sales (
    transaction_id, student_id, teacher_id, school_id, cashier_id,
    total,   subtotal,  discount,
    payment_method,
    cash_received, change_given,
    items
  )
  VALUES (
    v_transaction_id,
    CASE WHEN p_client_mode = 'student' THEN p_student_id ELSE NULL END,
    CASE WHEN p_client_mode = 'teacher' THEN p_teacher_id ELSE NULL END,
    p_school_id,
    p_cashier_id,
    v_total, v_total, 0,
    CASE
      WHEN p_client_mode = 'student' THEN
        CASE WHEN v_should_use_balance THEN 'saldo' ELSE 'debt' END
      WHEN p_client_mode = 'teacher' THEN 'teacher_account'
      ELSE
        CASE p_payment_method
          WHEN 'efectivo'      THEN 'cash'
          WHEN 'tarjeta'       THEN 'card'
          WHEN 'transferencia' THEN 'transfer'
          ELSE COALESCE(p_payment_method, 'cash')
        END
    END,
    CASE
      WHEN p_client_mode = 'generic'
       AND (p_payment_method = 'efectivo' OR p_payment_method IS NULL)
      THEN COALESCE(p_cash_given, v_total)
      ELSE NULL
    END,
    CASE
      WHEN p_client_mode = 'generic'
       AND (p_payment_method = 'efectivo' OR p_payment_method IS NULL)
      THEN COALESCE(p_cash_given, v_total) - v_total
      ELSE NULL
    END,
    v_line_items
  );

  -- ────────────────────────────────────────────────────────────────
  -- 12. DESCONTAR STOCK
  -- ────────────────────────────────────────────────────────────────
  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(p_lines) AS value
  LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := (v_elem->>'quantity')::numeric;

    IF NOT v_is_custom AND v_product_id IS NOT NULL THEN
      UPDATE product_stock
      SET    current_stock = current_stock - v_quantity,
             last_updated  = clock_timestamp()
      WHERE  product_id = v_product_id
        AND  school_id  = p_school_id
        AND  is_enabled = true;
    END IF;
  END LOOP;

  -- ────────────────────────────────────────────────────────────────
  -- 13. REGISTRAR CLAVE DE IDEMPOTENCIA
  -- ────────────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO pos_idempotency_keys (school_id, idempotency_key, transaction_id)
    VALUES (p_school_id, p_idempotency_key, v_transaction_id)
    ON CONFLICT (school_id, idempotency_key) DO NOTHING;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 14. DEVOLVER RESULTADO
  -- ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                 true,
    'transaction_id',     v_transaction_id,
    'ticket_code',        v_ticket_code,
    'total',              v_total,
    'balance_after',      v_balance_after,
    'payment_status',     v_payment_status,
    'business_date_lima', v_sale_date,
    'lines',              v_line_items
  );

END;
$$;

GRANT EXECUTE ON FUNCTION complete_pos_sale_v2(
  uuid, uuid, jsonb, text,
  uuid, uuid, text, jsonb, jsonb, text, numeric, jsonb, uuid
) TO authenticated, service_role;

SELECT '✅ complete_pos_sale_v2: DEFAULT efectivo eliminado, metodo de pago correcto para alumnos/profesores' AS status;
