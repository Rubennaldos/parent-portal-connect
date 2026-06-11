-- ============================================================
-- BLINDAJE KARDEX: venta_pos + decrement_product_stock_with_kardex
-- ============================================================
-- Problema confirmado: complete_pos_sale_v2 descuenta stock pero
-- NO insertaba fila en pos_stock_movements → 0 filas venta_pos.
--
-- Cambios:
--  1. Añadir 'salida_manual' al CHECK de movement_type
--  2. Nuevo RPC: decrement_product_stock_with_kardex (ajuste manual -)
--  3. Nuevo RPC: complete_pos_sale_v2 con kardex venta_pos en paso 13
-- ============================================================

-- ── 1) Ampliar CHECK de movement_type ───────────────────────────────────────
ALTER TABLE pos_stock_movements
  DROP CONSTRAINT IF EXISTS pos_stock_movements_movement_type_check;

ALTER TABLE pos_stock_movements
  ADD CONSTRAINT pos_stock_movements_movement_type_check
  CHECK (movement_type IN (
    'venta_pos',
    'ajuste_manual',
    'entrada_compra',
    'transfer_out',
    'transfer_in',
    'ajuste_inicial',
    'salida_manual'
  ));

SELECT 'OK: movement_type actualizado con salida_manual' AS resultado;

-- ── 2) RPC: decrement_product_stock_with_kardex ─────────────────────────────
-- Permite restas manuales desde UI de Stock Live.
-- Valida switch allow_negative_stock y registra salida_manual en kardex.
CREATE OR REPLACE FUNCTION decrement_product_stock_with_kardex(
  p_product_id uuid,
  p_school_id  uuid,
  p_quantity   integer,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_negative boolean := false;
  v_stock_before   integer := 0;
  v_stock_after    integer;
  v_product_name   text;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: la cantidad a restar debe ser mayor a 0';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = p_product_id) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: producto no existe (%)', p_product_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schools s WHERE s.id = p_school_id) THEN
    RAISE EXCEPTION 'INVALID_SCHOOL: sede no existe (%)', p_school_id;
  END IF;

  SELECT p.name INTO v_product_name
  FROM products p WHERE p.id = p_product_id;

  v_allow_negative := COALESCE(get_allow_negative_stock(), false);

  SELECT COALESCE(ps.current_stock, 0)
  INTO   v_stock_before
  FROM   product_stock ps
  WHERE  ps.product_id = p_product_id
    AND  ps.school_id  = p_school_id;

  IF NOT v_allow_negative AND (v_stock_before - p_quantity) < 0 THEN
    RAISE EXCEPTION
      'STOCK_BLOQUEADO: Stock insuficiente para "%". Disponible: %, Solicitado: %',
      v_product_name, v_stock_before, p_quantity;
  END IF;

  -- Suprimir trigger genérico (registramos con tipo específico abajo)
  PERFORM set_config('app.kardex_source', 'pos_rpc', true);

  UPDATE product_stock ps
  SET    current_stock = ps.current_stock - p_quantity,
         last_updated  = clock_timestamp()
  WHERE  ps.product_id = p_product_id
    AND  ps.school_id  = p_school_id;

  SELECT COALESCE(ps.current_stock, v_stock_before - p_quantity)
  INTO   v_stock_after
  FROM   product_stock ps
  WHERE  ps.product_id = p_product_id
    AND  ps.school_id  = p_school_id;

  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at,    reason
  ) VALUES (
    p_product_id,  p_school_id,
    'salida_manual',
    -p_quantity,
    v_stock_before, v_stock_after,
    NULL, auth.uid(),
    clock_timestamp(),
    COALESCE(p_reason, 'Ajuste manual de salida desde logística')
  );

  RETURN jsonb_build_object(
    'ok',           true,
    'stock_before', v_stock_before,
    'stock_after',  v_stock_after,
    'delta',        -p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION decrement_product_stock_with_kardex(uuid, uuid, integer, text)
  TO authenticated, service_role;

SELECT 'OK: decrement_product_stock_with_kardex creado' AS resultado;

-- ── 3) complete_pos_sale_v2 — Paso 13 con kardex venta_pos obligatorio ───────
DROP FUNCTION IF EXISTS complete_pos_sale_v2(uuid,uuid,jsonb,text,uuid,uuid,text,jsonb,jsonb,text,numeric,jsonb,uuid);
DROP FUNCTION IF EXISTS complete_pos_sale_v2(uuid,uuid,jsonb,text,uuid,uuid,text,jsonb,jsonb,text,numeric,jsonb);

CREATE OR REPLACE FUNCTION complete_pos_sale_v2(
  p_school_id        uuid,
  p_cashier_id       uuid,
  p_lines            jsonb,
  p_client_mode      text,
  p_student_id       uuid    DEFAULT NULL,
  p_teacher_id       uuid    DEFAULT NULL,
  p_payment_method   text    DEFAULT 'efectivo',
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
  v_elem          jsonb;
  v_product_id    uuid;
  v_quantity      numeric;
  v_is_custom     boolean;
  v_custom_name   text;
  v_custom_price  numeric;

  v_price_sale    numeric;
  v_product_name  text;
  v_line_total    numeric;
  v_total         numeric := 0;

  v_current_balance    numeric;
  v_is_free_account    boolean;
  v_kiosk_disabled     boolean;
  v_should_use_balance boolean;
  v_balance_after      numeric := 0;

  v_has_stock_ctrl       boolean;
  v_current_stock        integer;
  v_allow_negative_stock boolean := false;
  v_stock_before         integer;
  v_stock_after          integer;

  v_transaction_id  uuid;
  v_ticket_code     text;
  v_payment_status  text;
  v_sale_date       date;
  v_eff_method      text;

  v_doc_type        text;
  v_billing_method  text;
  v_is_taxable      boolean;
  v_billing_status  text;

  v_is_mixed    boolean;
  v_cash_amount numeric := 0;
  v_card_amount numeric := 0;
  v_yape_amount numeric := 0;

  v_line_items  jsonb := '[]'::jsonb;
  v_existing_tx uuid;
BEGIN
  -- ── 0. IDEMPOTENCIA ──────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT transaction_id INTO v_existing_tx
    FROM pos_idempotency_keys
    WHERE school_id       = p_school_id
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok',             true,
        'idempotent_hit', true,
        'transaction_id', v_existing_tx
      );
    END IF;
  END IF;

  -- ── 1. FECHA OPERATIVA en Lima ───────────────────────────────────
  v_sale_date            := (timezone('America/Lima', clock_timestamp()))::date;
  v_allow_negative_stock := COALESCE(get_allow_negative_stock(), false);

  -- ── 2. BLOQUEAR alumno (orden fijo: students → product_stock) ───
  IF p_client_mode = 'student' AND p_student_id IS NOT NULL THEN
    SELECT s.balance, s.free_account, s.kiosk_disabled
    INTO   v_current_balance, v_is_free_account, v_kiosk_disabled
    FROM   students s
    WHERE  s.id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND: Alumno no encontrado (id: %)', p_student_id;
    END IF;

    IF v_kiosk_disabled THEN
      RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado.';
    END IF;
  END IF;

  -- ── 3. BLOQUEAR filas de product_stock (orden determinista) ─────
  PERFORM ps.product_id
  FROM product_stock ps
  JOIN products p ON p.id = ps.product_id
  WHERE ps.school_id            = p_school_id
    AND ps.is_enabled           = true
    AND p.stock_control_enabled = true
    AND ps.product_id = ANY (
      ARRAY(
        SELECT (elem->>'product_id')::uuid
        FROM   jsonb_array_elements(p_lines) elem
        WHERE  NOT COALESCE((elem->>'is_custom')::boolean, false)
          AND  (elem->>'product_id') IS NOT NULL
      )
    )
  ORDER BY ps.product_id
  FOR UPDATE OF ps;

  -- ── 4. RESOLVER PRECIOS + VALIDAR STOCK línea por línea ─────────
  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(p_lines) AS value
  LOOP
    v_product_id   := (v_elem->>'product_id')::uuid;
    v_quantity     := COALESCE((v_elem->>'quantity')::numeric, 1);
    v_is_custom    := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_custom_name  := v_elem->>'custom_name';
    v_custom_price := (v_elem->>'custom_price')::numeric;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: La cantidad debe ser mayor a 0';
    END IF;

    IF v_is_custom THEN
      IF v_custom_price IS NULL OR v_custom_price <= 0 THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_PRICE: El precio de venta libre debe ser mayor a 0';
      END IF;
      v_price_sale   := v_custom_price;
      v_product_name := COALESCE(v_custom_name, 'Venta libre');

    ELSE
      SELECT psp.price_sale
      INTO   v_price_sale
      FROM   product_school_prices psp
      WHERE  psp.product_id   = v_product_id
        AND  psp.school_id    = p_school_id
        AND  psp.is_available = true
      LIMIT 1;

      IF NOT FOUND THEN
        SELECT p.price_sale, p.name
        INTO   v_price_sale, v_product_name
        FROM   products p
        WHERE  p.id = v_product_id AND p.active = true;

        IF NOT FOUND THEN
          SELECT p.price_sale, p.name
          INTO   v_price_sale, v_product_name
          FROM   products p
          WHERE  p.id = v_product_id;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Producto % no existe', v_product_id;
          END IF;
        END IF;
      ELSE
        SELECT p.name INTO v_product_name
        FROM   products p WHERE p.id = v_product_id;
      END IF;

      SELECT p.stock_control_enabled,
             COALESCE(ps.current_stock, 0)
      INTO   v_has_stock_ctrl, v_current_stock
      FROM   products p
      LEFT   JOIN product_stock ps
             ON  ps.product_id = p.id
             AND ps.school_id  = p_school_id
             AND ps.is_enabled = true
      WHERE  p.id = v_product_id;

      IF v_has_stock_ctrl
         AND NOT v_allow_negative_stock
         AND v_current_stock < v_quantity THEN
        RAISE EXCEPTION 'STOCK_BLOQUEADO: Venta en negativo desactivada.';
      END IF;
    END IF;

    v_line_total := round(v_price_sale * v_quantity, 2);
    v_total      := v_total + v_line_total;

    v_line_items := v_line_items || jsonb_build_array(
      jsonb_build_object(
        'product_id',   CASE WHEN v_is_custom THEN NULL ELSE to_jsonb(v_product_id) END,
        'product_name', v_product_name,
        'quantity',     v_quantity,
        'unit_price',   v_price_sale,
        'subtotal',     v_line_total,
        'is_custom',    v_is_custom
      )
    );
  END LOOP;

  v_total := round(v_total, 2);

  -- ── 5. VALIDAR SALDO Y DEFINIR MODO DE PAGO ─────────────────────
  IF p_client_mode = 'student' THEN
    v_is_free_account    := COALESCE(v_is_free_account, true);
    v_should_use_balance := (v_current_balance >= v_total);

    IF NOT v_should_use_balance AND NOT v_is_free_account THEN
      RAISE EXCEPTION
        'INSUFFICIENT_BALANCE: Saldo insuficiente. Saldo: S/ %, Total: S/ %',
        round(v_current_balance, 2), v_total;
    END IF;

    v_payment_status := CASE WHEN v_should_use_balance THEN 'paid' ELSE 'pending' END;

    IF v_should_use_balance THEN
      UPDATE students
      SET    balance = balance - v_total
      WHERE  id = p_student_id
      RETURNING balance INTO v_balance_after;
    ELSE
      v_balance_after := v_current_balance;
    END IF;

  ELSIF p_client_mode = 'teacher' THEN
    v_payment_status     := 'pending';
    v_should_use_balance := false;
    v_balance_after      := 0;

  ELSE
    v_payment_status     := 'paid';
    v_should_use_balance := false;
    v_balance_after      := 0;
  END IF;

  -- ── 6. FLAGS DE FACTURACIÓN ──────────────────────────────────────
  v_doc_type := COALESCE(p_billing_data->>'document_type', 'ticket');

  v_billing_method := CASE
    WHEN p_client_mode = 'student' AND v_should_use_balance     THEN 'saldo'
    WHEN p_client_mode = 'student' AND NOT v_should_use_balance THEN 'pagar_luego'
    WHEN p_client_mode = 'teacher'                              THEN 'pagar_luego'
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  v_is_taxable := CASE
    WHEN v_doc_type IN ('boleta', 'factura')                                        THEN true
    WHEN v_billing_method IN ('efectivo','cash','saldo','pagar_luego','adjustment') THEN false
    ELSE true
  END;

  v_billing_status := CASE WHEN v_is_taxable THEN 'pending' ELSE 'excluded' END;

  -- ── 7. CAMPOS DE PAGO MIXTO ──────────────────────────────────────
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

  -- ── 7b. VALIDAR SESIÓN DE CAJA (opcional) ───────────────────────
  IF p_cash_session_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cash_sessions
      WHERE id        = p_cash_session_id
        AND school_id = p_school_id
        AND status    = 'open'
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece a esta sede.';
    END IF;
  END IF;

  -- ── 8. NÚMERO DE TICKET ──────────────────────────────────────────
  SELECT get_next_ticket_number(p_cashier_id) INTO v_ticket_code;

  -- ── 9. MÉTODO EFECTIVO ───────────────────────────────────────────
  v_eff_method := CASE
    WHEN p_client_mode = 'student' THEN
      CASE WHEN v_should_use_balance THEN COALESCE(p_payment_method, 'saldo') ELSE NULL END
    WHEN p_client_mode = 'teacher' THEN NULL
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  -- ── 10. INSERTAR TRANSACCIÓN ─────────────────────────────────────
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
    COALESCE(p_payment_metadata, '{}') || jsonb_build_object('source', 'pos', 'source_channel', 'pos_kiosk'),
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

  -- ── 11. INSERTAR TRANSACTION_ITEMS ───────────────────────────────
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

  -- ── 12. INSERTAR SALES (módulo Finanzas) ─────────────────────────
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
        CASE WHEN v_should_use_balance
          THEN COALESCE(p_payment_method, 'saldo')
          ELSE 'debt'
        END
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

  -- ── 13. DESCONTAR STOCK + KARDEX venta_pos (BLINDADO) ────────────
  -- set_config suprime el trigger genérico de ajuste_manual para que
  -- no se duplique el movimiento con otro tipo de entrada.
  PERFORM set_config('app.kardex_source', 'pos_rpc', true);

  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(p_lines) AS value
  LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := (v_elem->>'quantity')::numeric;

    IF NOT v_is_custom AND v_product_id IS NOT NULL THEN

      -- Validar control de stock del producto.
      SELECT p.stock_control_enabled
      INTO   v_has_stock_ctrl
      FROM   products p
      WHERE  p.id = v_product_id;

      IF NOT COALESCE(v_has_stock_ctrl, false) THEN
        CONTINUE;
      END IF;

      -- Leer stock anterior SOLO en fila habilitada.
      -- Si no existe fila habilitada, se toma 0 para mantener coherencia
      -- con la validación del paso 4.
      SELECT ps.current_stock
      INTO   v_stock_before
      FROM   product_stock ps
      WHERE  ps.product_id = v_product_id
        AND  ps.school_id  = p_school_id
        AND  ps.is_enabled = true
      FOR UPDATE;

      IF NOT FOUND THEN
        v_stock_before := 0;
      END IF;

      -- Upsert robusto:
      -- - Si existe fila habilitada: descuenta sobre stock actual.
      -- - Si no existe o estaba deshabilitada: crea/reactiva en negativo.
      INSERT INTO product_stock (
        product_id, school_id, current_stock, is_enabled, last_updated
      )
      VALUES (
        v_product_id, p_school_id, -(v_quantity::integer), true, clock_timestamp()
      )
      ON CONFLICT (product_id, school_id)
      DO UPDATE SET
        current_stock = CASE
          WHEN product_stock.is_enabled
            THEN product_stock.current_stock - (v_quantity::integer)
          ELSE EXCLUDED.current_stock
        END,
        is_enabled   = true,
        last_updated = clock_timestamp()
      RETURNING current_stock INTO v_stock_after;

      v_stock_after := COALESCE(v_stock_after, v_stock_before - v_quantity::integer);

      -- Registrar en kardex: venta_pos vinculada a la transacción
      INSERT INTO pos_stock_movements (
        product_id,    school_id,
        movement_type, quantity_delta,
        stock_before,  stock_after,
        reference_id,  created_by,
        created_at,    reason
      ) VALUES (
        v_product_id,  p_school_id,
        'venta_pos',
        -(v_quantity::integer),
        v_stock_before, v_stock_after,
        v_transaction_id, p_cashier_id,
        clock_timestamp(),
        'Venta POS ticket ' || COALESCE(v_ticket_code, v_transaction_id::text)
      );

    END IF;
  END LOOP;

  -- ── 14. CLAVE DE IDEMPOTENCIA ────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO pos_idempotency_keys (school_id, idempotency_key, transaction_id)
    VALUES (p_school_id, p_idempotency_key, v_transaction_id)
    ON CONFLICT (school_id, idempotency_key) DO NOTHING;
  END IF;

  -- ── 15. RETORNAR RESULTADO ───────────────────────────────────────
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

SELECT 'BLINDAJE KARDEX OK: venta_pos en complete_pos_sale_v2 + decrement_product_stock_with_kardex' AS resultado;
