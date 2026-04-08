-- =====================================================================
-- MIGRACIÓN: Integridad del Número de Operación
-- Fecha: 2026-04-07
--
-- Objetivo:
--   1. Parchar complete_pos_sale_v2 para escribir operation_number en
--      la columna dedicada (además de en metadata).
--   2. Backfill histórico: copiar metadata->>'operation_number' a la
--      columna transactions.operation_number en registros antiguos.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. PARCHE AL RPC complete_pos_sale_v2
--    Añadimos operation_number a la lista de columnas del INSERT y
--    extraemos el valor de p_payment_metadata->>'operation_number'.
--    Se usa CREATE OR REPLACE para no romper la firma existente.
-- ─────────────────────────────────────────────────────────────────────
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
  p_payment_splits   jsonb   DEFAULT '[]'
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

  v_has_stock_ctrl boolean;
  v_current_stock  integer;

  v_transaction_id uuid;
  v_ticket_code    text;
  v_payment_status text;
  v_sale_date      date;
  v_eff_method     text;

  v_doc_type       text;
  v_billing_method text;
  v_is_taxable     boolean;
  v_billing_status text;

  v_is_mixed    boolean;
  v_cash_amount numeric := 0;
  v_card_amount numeric := 0;
  v_yape_amount numeric := 0;

  v_line_items  jsonb := '[]'::jsonb;

  v_existing_tx uuid;

  -- ── NUEVO: extraído de metadata para columna dedicada ──────────────
  v_operation_number text;
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 0. IDEMPOTENCIA
  -- ────────────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_tx
    FROM transactions
    WHERE metadata->>'idempotency_key' = p_idempotency_key
      AND school_id = p_school_id
    LIMIT 1;

    IF v_existing_tx IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success',        true,
        'transaction_id', v_existing_tx,
        'idempotent',     true,
        'message',        'Venta ya procesada (idempotencia)'
      );
    END IF;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 0b. Extraer operation_number de p_payment_metadata
  -- ────────────────────────────────────────────────────────────────
  v_operation_number := NULLIF(TRIM(COALESCE(p_payment_metadata->>'operation_number', '')), '');

  -- ────────────────────────────────────────────────────────────────
  -- 1. VALIDACIONES BÁSICAS
  -- ────────────────────────────────────────────────────────────────
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'school_id requerido';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Se requiere al menos un ítem en la venta';
  END IF;
  IF p_client_mode NOT IN ('student', 'teacher', 'generic') THEN
    RAISE EXCEPTION 'client_mode inválido: %', p_client_mode;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 2. DATOS DEL ALUMNO (solo si es student)
  -- ────────────────────────────────────────────────────────────────
  IF p_client_mode = 'student' THEN
    IF p_student_id IS NULL THEN
      RAISE EXCEPTION 'student_id requerido para client_mode=student';
    END IF;
    SELECT balance, free_account, kiosk_disabled
    INTO   v_current_balance, v_is_free_account, v_kiosk_disabled
    FROM   students
    WHERE  id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Alumno no encontrado: %', p_student_id;
    END IF;
    IF v_kiosk_disabled THEN
      RAISE EXCEPTION 'KIOSK_DISABLED: El kiosco de este alumno está desactivado';
    END IF;
    v_should_use_balance := NOT v_is_free_account;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 3. CALCULAR TOTALES Y VERIFICAR STOCK
  -- ────────────────────────────────────────────────────────────────
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_is_custom    := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_custom_name  := v_elem->>'custom_name';
    v_custom_price := (v_elem->>'custom_price')::numeric;

    IF v_is_custom THEN
      IF v_custom_price IS NULL OR v_custom_price <= 0 THEN
        RAISE EXCEPTION 'Precio inválido para ítem personalizado: %', v_custom_name;
      END IF;
      v_price_sale  := v_custom_price;
      v_product_name := COALESCE(v_custom_name, 'Ítem personalizado');
      v_product_id  := NULL;
    ELSE
      v_product_id := (v_elem->>'product_id')::uuid;
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'product_id requerido para ítem no personalizado';
      END IF;
      SELECT price_sale, name, has_stock_control, stock_quantity
      INTO   v_price_sale, v_product_name, v_has_stock_ctrl, v_current_stock
      FROM   products
      WHERE  id = v_product_id AND school_id = p_school_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_product_id;
      END IF;
    END IF;

    v_quantity   := COALESCE((v_elem->>'quantity')::numeric, 1);
    v_line_total := v_price_sale * v_quantity;
    v_total      := v_total + v_line_total;

    v_line_items := v_line_items || jsonb_build_object(
      'product_id',   v_product_id,
      'product_name', v_product_name,
      'quantity',     v_quantity,
      'unit_price',   v_price_sale,
      'subtotal',     v_line_total
    );
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total de venta inválido: %', v_total;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 4. VERIFICAR SALDO (solo alumnos con saldo)
  -- ────────────────────────────────────────────────────────────────
  IF p_client_mode = 'student' AND v_should_use_balance THEN
    IF v_current_balance < v_total THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Saldo insuficiente. Disponible: % | Requerido: %',
        v_current_balance, v_total;
    END IF;
    v_balance_after := v_current_balance - v_total;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 5. DESCONTAR STOCK (para ítems con control)
  -- ────────────────────────────────────────────────────────────────
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    IF v_is_custom THEN CONTINUE; END IF;

    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := COALESCE((v_elem->>'quantity')::numeric, 1);

    SELECT has_stock_control, COALESCE(stock_quantity, 0)
    INTO   v_has_stock_ctrl, v_current_stock
    FROM   products
    WHERE  id = v_product_id AND school_id = p_school_id;

    IF v_has_stock_ctrl THEN
      IF v_current_stock < v_quantity THEN
        SELECT name INTO v_product_name FROM products WHERE id = v_product_id;
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock insuficiente para %. Disponible: % | Solicitado: %',
          v_product_name, v_current_stock, v_quantity;
      END IF;

      UPDATE products
      SET stock_quantity       = stock_quantity - v_quantity,
          stock_before_last_sale = COALESCE(stock_quantity, 0)
      WHERE id = v_product_id AND school_id = p_school_id;
    END IF;
  END LOOP;

  -- ────────────────────────────────────────────────────────────────
  -- 6. ACTUALIZAR SALDO DEL ALUMNO
  -- ────────────────────────────────────────────────────────────────
  IF p_client_mode = 'student' AND v_should_use_balance THEN
    UPDATE students
    SET balance = v_balance_after
    WHERE id = p_student_id;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 7. GENERAR TICKET CODE
  -- ────────────────────────────────────────────────────────────────
  v_sale_date   := CURRENT_DATE;
  v_ticket_code := 'T-' || TO_CHAR(v_sale_date, 'YYYYMMDD') || '-' ||
                   LPAD(FLOOR(RANDOM() * 99999 + 1)::text, 5, '0');

  -- ────────────────────────────────────────────────────────────────
  -- 8. ESTADO DE PAGO Y MÉTODO EFECTIVO
  -- ────────────────────────────────────────────────────────────────
  v_payment_status := CASE
    WHEN p_client_mode = 'student' AND NOT v_should_use_balance THEN 'pending'
    ELSE 'paid'
  END;

  v_eff_method := CASE
    WHEN p_client_mode = 'student' AND NOT v_should_use_balance THEN NULL
    WHEN p_client_mode = 'teacher' THEN NULL
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  -- ────────────────────────────────────────────────────────────────
  -- 9. FACTURACIÓN
  -- ────────────────────────────────────────────────────────────────
  v_doc_type       := COALESCE(p_billing_data->>'document_type', 'ticket');
  v_is_taxable     := v_doc_type IN ('boleta', 'factura');
  v_billing_status := CASE WHEN v_is_taxable THEN 'pending' ELSE 'not_required' END;
  v_billing_method := p_payment_method;

  -- ────────────────────────────────────────────────────────────────
  -- 10a. PAGO MIXTO
  -- ────────────────────────────────────────────────────────────────
  v_is_mixed := (p_payment_method = 'mixto') OR
                (p_payment_splits IS NOT NULL AND jsonb_array_length(p_payment_splits) > 1);

  IF v_is_mixed AND p_payment_splits IS NOT NULL THEN
    SELECT
      COALESCE(SUM((s->>'amount')::numeric) FILTER (WHERE s->>'method' = 'efectivo'), 0),
      COALESCE(SUM((s->>'amount')::numeric) FILTER (WHERE s->>'method' IN ('tarjeta','card','visa','mastercard')), 0),
      COALESCE(SUM((s->>'amount')::numeric) FILTER (WHERE s->>'method' IN ('yape','plin','yape_qr','plin_qr','yape_numero','plin_numero')), 0)
    INTO v_cash_amount, v_card_amount, v_yape_amount
    FROM jsonb_array_elements(p_payment_splits) AS s;
  ELSIF p_payment_method = 'efectivo' THEN
    v_cash_amount := v_total;
  ELSIF p_payment_method IN ('tarjeta','card') THEN
    v_card_amount := v_total;
  ELSIF p_payment_method IN ('yape','plin','yape_qr','plin_qr','yape_numero','plin_numero') THEN
    v_yape_amount := v_total;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 10b. INSERTAR TRANSACCIÓN
  --      ★ NUEVO: incluye operation_number en columna dedicada
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO transactions (
    student_id,   teacher_id,  school_id,
    type,         amount,      description,
    balance_after, created_by, ticket_code,
    payment_status, payment_method, metadata,
    paid_with_mixed, cash_amount, card_amount, yape_amount,
    document_type, invoice_client_name, invoice_client_dni_ruc,
    is_taxable, billing_status,
    operation_number,          -- ★ NUEVO
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
    COALESCE(p_payment_metadata, '{}')
      || jsonb_build_object('source', 'pos')
      || CASE WHEN p_idempotency_key IS NOT NULL
              THEN jsonb_build_object('idempotency_key', p_idempotency_key)
              ELSE '{}' END,
    v_is_mixed,
    v_cash_amount,
    v_card_amount,
    v_yape_amount,
    v_doc_type,
    p_billing_data->>'client_name',
    p_billing_data->>'client_dni_ruc',
    v_is_taxable,
    v_billing_status,
    v_operation_number,        -- ★ NUEVO: NULL para efectivo, código para digitales
    clock_timestamp()
  )
  RETURNING id INTO v_transaction_id;

  -- ────────────────────────────────────────────────────────────────
  -- 11. INSERTAR TRANSACTION_ITEMS
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
    (item->>'product_id') IS NULL
  FROM jsonb_array_elements(v_line_items) AS item;

  -- ────────────────────────────────────────────────────────────────
  -- 12. RETORNAR RESULTADO
  -- ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',          true,
    'transaction_id',   v_transaction_id,
    'ticket_code',      v_ticket_code,
    'total',            v_total,
    'balance_after',    v_balance_after,
    'payment_status',   v_payment_status,
    'operation_number', v_operation_number
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. BACKFILL HISTÓRICO
--    Para transacciones del POS que tienen operation_number en metadata
--    pero la columna dedicada está vacía, copiar el valor.
-- ─────────────────────────────────────────────────────────────────────
UPDATE transactions
SET    operation_number = TRIM(metadata->>'operation_number')
WHERE  operation_number IS NULL
  AND  metadata->>'operation_number' IS NOT NULL
  AND  TRIM(metadata->>'operation_number') <> ''
  AND  is_deleted = false;

-- Verificación (sin efecto en producción — solo informativo)
DO $$
DECLARE
  v_updated integer;
BEGIN
  SELECT COUNT(*) INTO v_updated
  FROM transactions
  WHERE operation_number IS NOT NULL
    AND metadata->>'operation_number' IS NOT NULL;
  RAISE NOTICE 'Registros con operation_number en columna dedicada: %', v_updated;
END;
$$;
