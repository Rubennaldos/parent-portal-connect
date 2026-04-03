-- ================================================================
-- MIGRACIÓN: complete_pos_sale_v2
-- Venta POS completamente atómica en una sola transacción BD.
--
-- Reemplaza la cadena de llamadas del frontend:
--   adjust_student_balance + transactions + transaction_items +
--   sales + deduct_product_stock  (fire-and-forget)
--
-- Garantías:
--  1. Total calculado en BD con precios reales (product_school_prices ▸ products.price_sale).
--  2. SELECT FOR UPDATE en students y product_stock → evita race conditions.
--  3. ACID: si falla cualquier paso, ROLLBACK de toda la venta.
--  4. Fecha operativa = servidor en America/Lima (no el reloj de la cajera).
--  5. Clave de idempotencia → reintento de red no duplica la venta.
-- ================================================================


-- ── Tabla de idempotencia ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_idempotency_keys (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       uuid        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  idempotency_key text        NOT NULL,
  transaction_id  uuid,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (school_id, idempotency_key)
);

ALTER TABLE pos_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_idempotency_admin" ON pos_idempotency_keys;
CREATE POLICY "pos_idempotency_admin" ON pos_idempotency_keys
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin_general','superadmin','gestor_unidad','cajero','operador_caja')
    )
  );

CREATE INDEX IF NOT EXISTS idx_pos_idempotency_lookup
  ON pos_idempotency_keys (school_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_pos_idempotency_created
  ON pos_idempotency_keys (created_at);


-- ── Función principal ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS complete_pos_sale_v2(
  uuid, uuid, jsonb, text,
  uuid, uuid, text, jsonb, jsonb, text, numeric, jsonb
);

CREATE OR REPLACE FUNCTION complete_pos_sale_v2(
  p_school_id        uuid,
  p_cashier_id       uuid,
  p_lines            jsonb,       -- [{product_id, quantity, is_custom, custom_name, custom_price}]
  p_client_mode      text,        -- 'student' | 'teacher' | 'generic'
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
  -- iteración de líneas
  v_elem          jsonb;
  v_product_id    uuid;
  v_quantity      numeric;
  v_is_custom     boolean;
  v_custom_name   text;
  v_custom_price  numeric;

  -- precio y totales
  v_price_sale    numeric;
  v_product_name  text;
  v_line_total    numeric;
  v_total         numeric := 0;

  -- alumno
  v_current_balance   numeric;
  v_is_free_account   boolean;
  v_kiosk_disabled    boolean;
  v_should_use_balance boolean;
  v_balance_after     numeric := 0;

  -- stock
  v_has_stock_ctrl  boolean;
  v_current_stock   integer;

  -- transacción
  v_transaction_id  uuid;
  v_ticket_code     text;
  v_payment_status  text;
  v_sale_date       date;
  v_eff_method      text;

  -- facturación
  v_doc_type        text;
  v_billing_method  text;
  v_is_taxable      boolean;
  v_billing_status  text;

  -- pago mixto
  v_is_mixed    boolean;
  v_cash_amount numeric := 0;
  v_card_amount numeric := 0;
  v_yape_amount numeric := 0;

  -- items acumulados
  v_line_items  jsonb := '[]'::jsonb;

  -- idempotencia
  v_existing_tx uuid;
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 0. IDEMPOTENCIA — mismo key = devolver resultado anterior sin
  --    volver a insertar nada
  -- ────────────────────────────────────────────────────────────────
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

  -- ────────────────────────────────────────────────────────────────
  -- 1. FECHA OPERATIVA en Lima — nunca el reloj de la cajera
  -- ────────────────────────────────────────────────────────────────
  v_sale_date := (timezone('America/Lima', clock_timestamp()))::date;

  -- ────────────────────────────────────────────────────────────────
  -- 2. BLOQUEAR alumno PRIMERO (orden fijo: students → product_stock)
  --    Evita deadlocks con otras transacciones concurrentes
  -- ────────────────────────────────────────────────────────────────
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

  -- ────────────────────────────────────────────────────────────────
  -- 3. BLOQUEAR filas de product_stock en orden UUID ascendente
  --    (orden determinista → evita deadlocks entre cajeras)
  --    Solo los productos reales con stock_control_enabled = true
  -- ────────────────────────────────────────────────────────────────
  PERFORM ps.product_id
  FROM product_stock ps
  JOIN products p ON p.id = ps.product_id
  WHERE ps.school_id        = p_school_id
    AND ps.is_enabled       = true
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

  -- ────────────────────────────────────────────────────────────────
  -- 4. RESOLVER PRECIOS + VALIDAR STOCK línea por línea
  -- ────────────────────────────────────────────────────────────────
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
      -- Venta libre: precio autorizado por el cajero
      IF v_custom_price IS NULL OR v_custom_price <= 0 THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_PRICE: El precio de venta libre debe ser mayor a 0';
      END IF;
      v_price_sale   := v_custom_price;
      v_product_name := COALESCE(v_custom_name, 'Venta libre');

    ELSE
      -- Producto real: primero buscar precio por sede, luego precio base
      SELECT psp.price_sale
      INTO   v_price_sale
      FROM   product_school_prices psp
      WHERE  psp.product_id  = v_product_id
        AND  psp.school_id   = p_school_id
        AND  psp.is_available = true
      LIMIT 1;

      IF NOT FOUND THEN
        -- Usar precio base del producto
        SELECT p.price_sale, p.name
        INTO   v_price_sale, v_product_name
        FROM   products p
        WHERE  p.id = v_product_id
          AND  p.active = true;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Producto % no existe o está inactivo', v_product_id;
        END IF;
      ELSE
        SELECT p.name INTO v_product_name
        FROM   products p WHERE p.id = v_product_id;
      END IF;

      -- Verificar stock (fila ya bloqueada en paso 3)
      SELECT p.stock_control_enabled,
             COALESCE(ps.current_stock, 0)
      INTO   v_has_stock_ctrl, v_current_stock
      FROM   products p
      LEFT   JOIN product_stock ps
             ON  ps.product_id = p.id
             AND ps.school_id  = p_school_id
             AND ps.is_enabled = true
      WHERE  p.id = v_product_id;

      IF v_has_stock_ctrl AND v_current_stock < v_quantity THEN
        RAISE EXCEPTION
          'INSUFFICIENT_STOCK: Stock insuficiente para "%". Disponible: %, Solicitado: %',
          v_product_name, v_current_stock, v_quantity::integer;
      END IF;
    END IF;

    -- Subtotal con redondeo por línea (evita acumulación de error flotante)
    v_line_total := round(v_price_sale * v_quantity, 2);
    v_total      := v_total + v_line_total;

    -- Acumular línea procesada
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

  -- Total final
  v_total := round(v_total, 2);

  -- ────────────────────────────────────────────────────────────────
  -- 5. VALIDAR SALDO Y DEFINIR MODO DE PAGO
  -- ────────────────────────────────────────────────────────────────
  IF p_client_mode = 'student' THEN
    v_is_free_account    := COALESCE(v_is_free_account, true);  -- NULL = cuenta libre
    v_should_use_balance := (v_current_balance >= v_total);

    IF NOT v_should_use_balance AND NOT v_is_free_account THEN
      RAISE EXCEPTION
        'INSUFFICIENT_BALANCE: Saldo insuficiente. Saldo: S/ %, Total: S/ %',
        round(v_current_balance, 2), v_total;
    END IF;

    v_payment_status := CASE WHEN v_should_use_balance THEN 'paid' ELSE 'pending' END;

    IF v_should_use_balance THEN
      -- Descontar saldo dentro de la misma transacción (la fila ya está bloqueada)
      UPDATE students
      SET    balance = balance - v_total
      WHERE  id = p_student_id
      RETURNING balance INTO v_balance_after;
    ELSE
      v_balance_after := v_current_balance;   -- cuenta libre sin saldo: no se toca
    END IF;

  ELSIF p_client_mode = 'teacher' THEN
    v_payment_status     := 'pending';
    v_should_use_balance := false;
    v_balance_after      := 0;

  ELSE  -- generic
    v_payment_status     := 'paid';
    v_should_use_balance := false;
    v_balance_after      := 0;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 6. CALCULAR FLAGS DE FACTURACIÓN (replica calcBillingFlags de TS)
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
    ELSE true   -- ticket + método digital
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
  --    (misma transacción; advisory lock interno garantiza unicidad)
  -- ────────────────────────────────────────────────────────────────
  SELECT get_next_ticket_number(p_cashier_id) INTO v_ticket_code;

  -- ────────────────────────────────────────────────────────────────
  -- 9. INSERTAR TRANSACCIÓN
  --    created_at = clock_timestamp() del servidor, nunca del cliente
  -- ────────────────────────────────────────────────────────────────
  v_eff_method := CASE
    WHEN p_client_mode = 'student' THEN
      CASE WHEN v_should_use_balance THEN COALESCE(p_payment_method, 'saldo') ELSE NULL END
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

  -- ────────────────────────────────────────────────────────────────
  -- 12. DESCONTAR STOCK (dentro de la MISMA transacción)
  --     Ya no es fire-and-forget: si falla aquí, se revierte todo
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
      -- Sin fila habilitada: ignorar (producto sin control de stock activo)
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
  -- 14. DEVOLVER RESULTADO AL CLIENTE
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

  -- Cualquier RAISE EXCEPTION (INSUFFICIENT_STOCK, INSUFFICIENT_BALANCE, etc.)
  -- hace ROLLBACK automático de toda la transacción antes de llegar al cliente.
END;
$$;

GRANT EXECUTE ON FUNCTION complete_pos_sale_v2(
  uuid, uuid, jsonb, text,
  uuid, uuid, text, jsonb, jsonb, text, numeric, jsonb
) TO authenticated, service_role;

SELECT '✅ complete_pos_sale_v2 + pos_idempotency_keys creados correctamente' AS status;
