-- ================================================================
-- FIX: null value in column "stock_before" of pos_stock_movements
-- ================================================================
-- CAUSA:
--   En complete_pos_sale_v2 (paso 12), la variable v_stock_before
--   se declara como `integer` sin valor por defecto.
--   Si el producto no tiene una fila en product_stock con
--   is_enabled = true, el SELECT no encuentra nada y v_stock_before
--   queda NULL. El INSERT posterior falla con:
--     "null value in column "stock_before" violates not-null constraint"
--
-- SOLUCIÓN:
--   · Inicializar v_stock_before := 0 en el bloque DECLARE.
--   · Aplicar COALESCE(v_stock_before, 0) en el INSERT como doble
--     protección (defense-in-depth).
--   · Omitir el INSERT en pos_stock_movements si no se encontró
--     ninguna fila de product_stock activa (no tiene sentido
--     registrar en el Kardex un producto sin control de stock).
--
-- Se recrea únicamente la versión final del RPC (la de p2 con Kardex).
-- ================================================================

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
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;

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
  -- FIX: inicializar a 0 para evitar NULL cuando el SELECT no encuentra fila
  v_stock_before   integer := 0;
  v_stock_found    boolean := false;   -- bandera: ¿encontramos fila de stock?

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
  v_effective_session_id uuid;
BEGIN

  -- ── 0. IDEMPOTENCIA ─────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT transaction_id INTO v_existing_tx
    FROM pos_idempotency_keys
    WHERE school_id = p_school_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true, 'idempotent_hit', true, 'transaction_id', v_existing_tx
      );
    END IF;
  END IF;

  -- ── 1. AUTORIZACIÓN DEL CALLER ──────────────────────────────────
  SELECT id, role, school_id
  INTO   v_caller_id, v_caller_role, v_caller_school
  FROM   profiles
  WHERE  id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Perfil no encontrado para este usuario.';
  END IF;

  IF v_caller_role NOT IN ('admin_general','superadmin','gestor_unidad','cajero','operador_caja') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Rol % sin permiso para ventas POS.', v_caller_role;
  END IF;

  IF v_caller_role IN ('gestor_unidad','cajero','operador_caja')
     AND v_caller_school IS DISTINCT FROM p_school_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No puedes vender en una sede diferente a la tuya.';
  END IF;

  -- ── 2. FECHA OPERATIVA LIMA ──────────────────────────────────────
  v_sale_date := (timezone('America/Lima', clock_timestamp()))::date;

  -- ── 3. BLOQUEAR ALUMNO ──────────────────────────────────────────
  IF p_client_mode = 'student' AND p_student_id IS NOT NULL THEN
    SELECT s.balance, s.free_account, s.kiosk_disabled
    INTO   v_current_balance, v_is_free_account, v_kiosk_disabled
    FROM   students s WHERE s.id = p_student_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND: Alumno no encontrado (id: %)', p_student_id;
    END IF;
    IF v_kiosk_disabled THEN
      RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado.';
    END IF;
  END IF;

  -- ── 4. BLOQUEAR FILAS DE PRODUCT_STOCK (orden UUID, evita deadlocks) ──
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

  -- ── 5. RESOLVER PRECIOS + VALIDAR STOCK ────────────────────────
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_lines) AS value LOOP
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
      SELECT psp.price_sale INTO v_price_sale
      FROM product_school_prices psp
      WHERE psp.product_id = v_product_id
        AND psp.school_id = p_school_id AND psp.is_available = true
      LIMIT 1;

      IF NOT FOUND THEN
        SELECT p.price_sale, p.name INTO v_price_sale, v_product_name
        FROM products p WHERE p.id = v_product_id AND p.active = true;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Producto % no existe o está inactivo', v_product_id;
        END IF;
      ELSE
        SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
      END IF;

      SELECT p.stock_control_enabled, COALESCE(ps.current_stock, 0)
      INTO v_has_stock_ctrl, v_current_stock
      FROM products p
      LEFT JOIN product_stock ps
        ON ps.product_id = p.id AND ps.school_id = p_school_id AND ps.is_enabled = true
      WHERE p.id = v_product_id;

      IF v_has_stock_ctrl AND v_current_stock < v_quantity THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock insuficiente para "%". Disponible: %, Solicitado: %',
          v_product_name, v_current_stock, v_quantity::integer;
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

  -- ── 6. VALIDAR SALDO / MODO DE PAGO ────────────────────────────
  IF p_client_mode = 'student' THEN
    v_is_free_account    := COALESCE(v_is_free_account, true);
    v_should_use_balance := (v_current_balance >= v_total);

    IF NOT v_should_use_balance AND NOT v_is_free_account THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Saldo insuficiente. Saldo: S/ %, Total: S/ %',
        round(v_current_balance, 2), v_total;
    END IF;

    v_payment_status := CASE WHEN v_should_use_balance THEN 'paid' ELSE 'pending' END;

    IF v_should_use_balance THEN
      UPDATE students SET balance = balance - v_total WHERE id = p_student_id
      RETURNING balance INTO v_balance_after;
    ELSE
      v_balance_after := v_current_balance;
    END IF;

  ELSIF p_client_mode = 'teacher' THEN
    v_payment_status := 'pending'; v_should_use_balance := false; v_balance_after := 0;
  ELSE
    v_payment_status := 'paid';   v_should_use_balance := false; v_balance_after := 0;
  END IF;

  -- ── 7. FLAGS DE FACTURACIÓN ──────────────────────────────────────
  v_doc_type := COALESCE(p_billing_data->>'document_type', 'ticket');

  v_billing_method := CASE
    WHEN p_client_mode = 'student' AND     v_should_use_balance THEN 'saldo'
    WHEN p_client_mode = 'student' AND NOT v_should_use_balance THEN 'pagar_luego'
    WHEN p_client_mode = 'teacher'                               THEN 'pagar_luego'
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  v_is_taxable := CASE
    WHEN v_doc_type IN ('boleta','factura')                                         THEN true
    WHEN v_billing_method IN ('efectivo','cash','saldo','pagar_luego','adjustment') THEN false
    ELSE true
  END;

  v_billing_status := CASE WHEN v_is_taxable THEN 'pending' ELSE 'excluded' END;

  -- ── 8. PAGO MIXTO ────────────────────────────────────────────────
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

  -- ── 9. NÚMERO DE TICKET ──────────────────────────────────────────
  SELECT get_next_ticket_number(p_cashier_id) INTO v_ticket_code;

  -- ── 10. SESIÓN DE CAJA ──────────────────────────────────────────
  IF p_cash_session_id IS NOT NULL THEN
    SELECT id INTO v_effective_session_id
    FROM cash_sessions
    WHERE id        = p_cash_session_id
      AND school_id = p_school_id
      AND status    = 'open';

    IF NOT FOUND THEN
      IF v_caller_role IN ('admin_general','superadmin') THEN
        v_effective_session_id := NULL;
      ELSE
        RAISE EXCEPTION 'NO_OPEN_SESSION: Sesión de caja inválida o cerrada. (session_id: %)',
          p_cash_session_id;
      END IF;
    END IF;
  ELSE
    SELECT id INTO v_effective_session_id
    FROM cash_sessions
    WHERE school_id = p_school_id
      AND status    = 'open'
    ORDER BY opened_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      IF v_caller_role IN ('admin_general','superadmin') THEN
        v_effective_session_id := NULL;
      ELSE
        RAISE EXCEPTION 'NO_OPEN_SESSION: No hay sesión de caja abierta para esta sede.';
      END IF;
    END IF;
  END IF;

  -- ── 11. INSERTAR TRANSACCIÓN ────────────────────────────────────
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
    cash_session_id,
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
    v_caller_id,
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
    v_effective_session_id,
    clock_timestamp()
  )
  RETURNING id INTO v_transaction_id;

  -- ── 12. TRANSACTION_ITEMS ───────────────────────────────────────
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

  -- ── 13. SALES ───────────────────────────────────────────────────
  INSERT INTO sales (
    transaction_id, student_id, teacher_id, school_id, cashier_id,
    total, subtotal, discount,
    payment_method,
    cash_received, change_given,
    items
  )
  VALUES (
    v_transaction_id,
    CASE WHEN p_client_mode = 'student' THEN p_student_id ELSE NULL END,
    CASE WHEN p_client_mode = 'teacher' THEN p_teacher_id ELSE NULL END,
    p_school_id,
    v_caller_id,
    v_total, v_total, 0,
    CASE
      WHEN p_client_mode = 'student' THEN
        CASE WHEN v_should_use_balance THEN COALESCE(p_payment_method,'saldo') ELSE 'debt' END
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
      THEN COALESCE(p_cash_given, v_total) ELSE NULL
    END,
    CASE
      WHEN p_client_mode = 'generic'
       AND (p_payment_method = 'efectivo' OR p_payment_method IS NULL)
      THEN COALESCE(p_cash_given, v_total) - v_total ELSE NULL
    END,
    v_line_items
  );

  -- ── 14. DESCONTAR STOCK + REGISTRAR EN KARDEX ──────────────────
  -- FIX APLICADO: v_stock_before se inicializa a 0 en DECLARE.
  -- Además, solo se inserta en pos_stock_movements si realmente
  -- existe una fila activa en product_stock (v_stock_found = true).
  -- Esto previene:
  --   "null value in column stock_before violates not-null constraint"
  PERFORM set_config('app.kardex_source', 'pos_rpc', true);

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_lines) AS value LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := (v_elem->>'quantity')::numeric;

    IF NOT v_is_custom AND v_product_id IS NOT NULL THEN

      -- ► FIX: reiniciar bandera y valor en cada iteración del loop
      v_stock_before := 0;
      v_stock_found  := false;

      SELECT current_stock INTO v_stock_before
      FROM product_stock
      WHERE product_id = v_product_id
        AND school_id  = p_school_id
        AND is_enabled = true;

      -- GET DIAGNOSTICS para detectar si el SELECT encontró fila
      v_stock_found := FOUND;

      -- ► FIX: COALESCE como protección extra (defense-in-depth)
      v_stock_before := COALESCE(v_stock_before, 0);

      -- Descontar stock (solo si hay fila activa)
      IF v_stock_found THEN
        UPDATE product_stock
        SET current_stock = current_stock - v_quantity,
            last_updated  = clock_timestamp()
        WHERE product_id = v_product_id
          AND school_id  = p_school_id
          AND is_enabled = true;

        -- Registrar en Kardex SOLO si la fila de stock existe
        -- (sin fila activa no hay nada que registrar)
        INSERT INTO pos_stock_movements (
          product_id,    school_id,
          movement_type, quantity_delta,
          stock_before,  stock_after,
          reference_id,  created_by, created_at
        ) VALUES (
          v_product_id, p_school_id,
          'venta_pos', -(v_quantity::integer),
          v_stock_before,                          -- nunca NULL (inicializado a 0)
          v_stock_before - v_quantity::integer,    -- nunca NULL
          v_transaction_id, v_caller_id, clock_timestamp()
        );
      END IF;
      -- Si no hay fila activa: ignorar silenciosamente (producto sin control de stock)

    END IF;
  END LOOP;

  -- ── 15. REGISTRAR CLAVE DE IDEMPOTENCIA ─────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO pos_idempotency_keys (school_id, idempotency_key, transaction_id)
    VALUES (p_school_id, p_idempotency_key, v_transaction_id)
    ON CONFLICT (school_id, idempotency_key) DO NOTHING;
  END IF;

  -- ── 16. RESULTADO ───────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                 true,
    'transaction_id',     v_transaction_id,
    'ticket_code',        v_ticket_code,
    'total',              v_total,
    'balance_after',      v_balance_after,
    'payment_status',     v_payment_status,
    'business_date_lima', v_sale_date,
    'cash_session_id',    v_effective_session_id,
    'lines',              v_line_items
  );

END;
$$;

GRANT EXECUTE ON FUNCTION complete_pos_sale_v2(
  uuid, uuid, jsonb, text,
  uuid, uuid, text, jsonb, jsonb, text, numeric, jsonb, uuid
) TO authenticated, service_role;

SELECT '✅ FIX stock_before NULL: complete_pos_sale_v2 parcheado correctamente' AS status;
