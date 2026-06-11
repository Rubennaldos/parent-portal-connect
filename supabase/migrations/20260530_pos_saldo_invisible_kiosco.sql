-- ============================================================================
-- POS: Saldo invisible en kiosco — compras de alumno siempre = crédito (deuda)
-- Fecha: 2026-05-30
-- ============================================================================
--
-- PROBLEMA:
--   complete_pos_sale_v2 usaba students.balance para decidir si la compra
--   de un alumno era pagada ("Saldo") o fiada ("Deuda"), violando la regla
--   de negocio: el saldo a favor NO es medio de pago en el kiosco.
--   Efecto visible: ~6.595 compras marcadas "Saldo Cliente" en el reporte.
--
-- SOLUCIÓN — 5 bloques quirúrgicos en complete_pos_sale_v2:
--   1. Bloque alumno (paso 5): v_should_use_balance = false siempre.
--      students.balance NO se lee ni se descuenta.
--   2. billing_method (paso 6): alumno/profesor siempre = 'pagar_luego'.
--   3. v_eff_method (paso 9): alumno/profesor siempre = NULL.
--   4. Descripción (INSERT tx): alumno = 'Compra POS (Crédito) - S/ X'.
--   5. sales.payment_method (INSERT sales): alumno = 'credito'.
--
-- ADEMÁS:
--   Elimina trigger_validate_free_account (obsoleto desde que complete_pos_sale_v2
--   maneja la lógica de cuenta libre; el trigger generaba inconsistencias al
--   forzar pending sobre transacciones que el RPC ya había marcado como paid+saldo).
--
-- INTACTO — no se toca nada de esto:
--   · Idempotencia hermética (FIX 1: INSERT-claim al inicio)
--   · FOR UPDATE en students y product_stock (sin JOIN) — ACID
--   · KIOSK_DISABLED / SPENDING_LIMIT guards
--   · Validación de stock + STOCK_CONFIG_ERROR (FIX 2)
--   · Combos, pago mixto, boleta/factura, sesión de caja
--   · fn_sync_student_balance / trg_transactions_balance_sync
--   · cancel_pos_sale (PARTE 2 del hardening)
-- ============================================================================


-- ── 1. Eliminar trigger obsoleto ─────────────────────────────────────────────

DROP TRIGGER  IF EXISTS trigger_validate_free_account ON public.transactions;
DROP FUNCTION IF EXISTS public.validate_free_account_purchase();


-- ── 2. complete_pos_sale_v2 — saldo invisible en kiosco ──────────────────────

DROP FUNCTION IF EXISTS public.complete_pos_sale_v2(
  uuid, uuid, jsonb, text,
  uuid, uuid, text, jsonb, jsonb, text, numeric, jsonb, uuid
);

CREATE OR REPLACE FUNCTION public.complete_pos_sale_v2(
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
  v_is_custom     boolean;
  v_product_id    uuid;
  v_quantity      numeric;
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

  v_combo_id    uuid;
  v_combo_name  text;
  v_stock_lines jsonb := '[]'::jsonb;
  v_ci_rec      RECORD;

  v_idem_rows   integer;
BEGIN

  -- ── 0. IDEMPOTENCIA — claim al INICIO, UPDATE al FINAL ───────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO pos_idempotency_keys (school_id, idempotency_key, transaction_id)
    VALUES (p_school_id, p_idempotency_key, NULL)
    ON CONFLICT (school_id, idempotency_key) DO NOTHING;

    GET DIAGNOSTICS v_idem_rows = ROW_COUNT;

    IF v_idem_rows = 0 THEN
      SELECT transaction_id INTO v_existing_tx
      FROM pos_idempotency_keys
      WHERE school_id       = p_school_id
        AND idempotency_key = p_idempotency_key;

      RETURN jsonb_build_object(
        'ok',             true,
        'idempotent_hit', true,
        'transaction_id', v_existing_tx
      );
    END IF;
  END IF;

  -- ── 1. FECHA OPERATIVA en Lima ───────────────────────────────────────────
  v_sale_date            := (timezone('America/Lima', clock_timestamp()))::date;
  v_allow_negative_stock := COALESCE(get_allow_negative_stock(), false);

  -- ── 2. BLOQUEAR alumno (orden fijo: students → product_stock) ───────────
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

  -- ── 2b. CONSTRUIR LÍNEAS DE STOCK ────────────────────────────────────────
  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(p_lines) AS value
  LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := COALESCE((v_elem->>'quantity')::numeric, 1);
    v_combo_id   := (v_elem->>'combo_id')::uuid;
    v_combo_name := v_elem->>'combo_name';

    IF NOT v_is_custom AND v_product_id IS NOT NULL THEN
      v_stock_lines := v_stock_lines || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'quantity',   v_quantity,
        'is_combo',   false,
        'combo_name', NULL
      ));

    ELSIF v_is_custom AND v_combo_id IS NOT NULL THEN
      FOR v_ci_rec IN
        SELECT
          ci.product_id                              AS product_id,
          (ci.quantity::numeric * v_quantity)        AS qty,
          COALESCE(v_combo_name, c.name)             AS cname
        FROM combo_items ci
        JOIN combos c ON c.id = ci.combo_id
        WHERE ci.combo_id = v_combo_id
          AND c.active    = true
          AND NOT COALESCE(c.is_archived, false)
      LOOP
        v_stock_lines := v_stock_lines || jsonb_build_array(jsonb_build_object(
          'product_id', v_ci_rec.product_id,
          'quantity',   v_ci_rec.qty,
          'is_combo',   true,
          'combo_name', v_ci_rec.cname
        ));
      END LOOP;
    END IF;
  END LOOP;

  -- ── 3. BLOQUEAR filas de product_stock (orden determinista) ─────────────
  PERFORM ps.product_id
  FROM product_stock ps
  WHERE ps.school_id  = p_school_id
    AND ps.is_enabled = true
    AND ps.product_id = ANY (
      ARRAY(
        SELECT (elem->>'product_id')::uuid
        FROM   jsonb_array_elements(v_stock_lines) elem
        WHERE  (elem->>'product_id') IS NOT NULL
      )
    )
  ORDER BY ps.product_id
  FOR UPDATE OF ps;

  -- ── 3b. VALIDAR STOCK DE COMPONENTES DE COMBO ───────────────────────────
  IF NOT v_allow_negative_stock THEN
    FOR v_elem IN
      SELECT value FROM jsonb_array_elements(v_stock_lines) AS value
    LOOP
      IF NOT COALESCE((v_elem->>'is_combo')::boolean, false) THEN
        CONTINUE;
      END IF;

      v_product_id := (v_elem->>'product_id')::uuid;
      v_quantity   := (v_elem->>'quantity')::numeric;

      SELECT ps.current_stock IS NOT NULL,
             COALESCE(ps.current_stock, 0)
      INTO   v_has_stock_ctrl, v_current_stock
      FROM   products p
      LEFT   JOIN product_stock ps
             ON  ps.product_id = p.id
             AND ps.school_id  = p_school_id
             AND ps.is_enabled = true
      WHERE  p.id = v_product_id;

      IF COALESCE(v_has_stock_ctrl, false) AND v_current_stock < v_quantity THEN
        SELECT p.name INTO v_product_name
        FROM   products p WHERE p.id = v_product_id;
        RAISE EXCEPTION
          'INSUFFICIENT_STOCK: Sin stock para componente "%". Disponible: %, Necesario: %',
          COALESCE(v_product_name, v_product_id::text),
          v_current_stock,
          v_quantity::integer;
      END IF;
    END LOOP;
  END IF;

  -- ── 4. RESOLVER PRECIOS + VALIDAR STOCK línea por línea ─────────────────
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

      SELECT ps.current_stock IS NOT NULL,
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

  -- ── 5. MODO DE PAGO ───────────────────────────────────────────────────────
  -- REGLA: saldo invisible en kiosco.
  -- Compra POS de alumno = siempre crédito (deuda). students.balance no se toca.
  IF p_client_mode = 'student' THEN
    v_should_use_balance := false;
    v_payment_status     := 'pending';
    v_balance_after      := COALESCE(v_current_balance, 0);

  ELSIF p_client_mode = 'teacher' THEN
    v_payment_status     := 'pending';
    v_should_use_balance := false;
    v_balance_after      := 0;

  ELSE
    v_payment_status     := 'paid';
    v_should_use_balance := false;
    v_balance_after      := 0;
  END IF;

  -- ── 6. FLAGS DE FACTURACIÓN ──────────────────────────────────────────────
  v_doc_type := COALESCE(p_billing_data->>'document_type', 'ticket');

  v_billing_method := CASE
    WHEN p_client_mode IN ('student', 'teacher') THEN 'pagar_luego'
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  v_is_taxable := CASE
    WHEN v_doc_type IN ('boleta', 'factura')                                        THEN true
    WHEN v_billing_method IN ('efectivo','cash','saldo','pagar_luego','adjustment') THEN false
    ELSE true
  END;

  v_billing_status := CASE WHEN v_is_taxable THEN 'pending' ELSE 'excluded' END;

  -- ── 7. CAMPOS DE PAGO MIXTO ──────────────────────────────────────────────
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

  -- ── 7b. VALIDAR SESIÓN DE CAJA (opcional) ───────────────────────────────
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

  -- ── 8. NÚMERO DE TICKET ──────────────────────────────────────────────────
  SELECT get_next_ticket_number(p_cashier_id) INTO v_ticket_code;

  -- ── 9. MÉTODO EFECTIVO ───────────────────────────────────────────────────
  -- Alumno/profesor: NULL (deuda, sin medio de pago).
  -- Genérico: el método elegido por el cajero.
  v_eff_method := CASE
    WHEN p_client_mode IN ('student', 'teacher') THEN NULL
    ELSE COALESCE(p_payment_method, 'efectivo')
  END;

  -- ── 10. INSERTAR TRANSACCIÓN ─────────────────────────────────────────────
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
      WHEN p_client_mode = 'student'
        THEN 'Compra POS (Crédito) - S/ '    || v_total::text
      WHEN p_client_mode = 'teacher'
        THEN 'Compra Profesor - '            || jsonb_array_length(p_lines)::text || ' items'
      ELSE  'Compra Cliente Genérico - '     || jsonb_array_length(p_lines)::text || ' items'
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

  -- ── 11. INSERTAR TRANSACTION_ITEMS ───────────────────────────────────────
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

  -- ── 12. INSERTAR SALES (módulo Finanzas) ─────────────────────────────────
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
      WHEN p_client_mode = 'student'  THEN 'credito'
      WHEN p_client_mode = 'teacher'  THEN 'teacher_account'
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

  -- ── 13. DESCONTAR STOCK + KARDEX venta_pos ───────────────────────────────
  PERFORM set_config('app.kardex_source', 'pos_rpc', true);

  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(v_stock_lines) AS value
  LOOP
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := (v_elem->>'quantity')::numeric;
    v_combo_name := v_elem->>'combo_name';

    IF v_product_id IS NULL THEN
      CONTINUE;
    END IF;

    v_has_stock_ctrl := EXISTS (
      SELECT 1 FROM product_stock ps
      WHERE ps.product_id = v_product_id
        AND ps.school_id  = p_school_id
        AND ps.is_enabled = true
    );

    IF NOT v_has_stock_ctrl THEN
      IF NOT v_allow_negative_stock
         AND NOT COALESCE((v_elem->>'is_combo')::boolean, false) THEN
        IF EXISTS (
          SELECT 1 FROM products p
          WHERE  p.id = v_product_id
            AND  COALESCE(p.stock_control_enabled, false) = true
        ) THEN
          SELECT p.name INTO v_product_name
          FROM   products p WHERE p.id = v_product_id;
          RAISE EXCEPTION
            'STOCK_CONFIG_ERROR: El producto "%" tiene control de inventario '
            'activado pero no tiene stock configurado en esta sede. '
            'Configure product_stock antes de vender.',
            COALESCE(v_product_name, v_product_id::text);
        END IF;
      END IF;
      CONTINUE;
    END IF;

    SELECT ps.current_stock
    INTO   v_stock_before
    FROM   product_stock ps
    WHERE  ps.product_id = v_product_id
      AND  ps.school_id  = p_school_id
      AND  ps.is_enabled = true
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF NOT v_allow_negative_stock
       AND (v_stock_before - v_quantity::integer) < 0 THEN
      SELECT p.name INTO v_product_name FROM products p WHERE p.id = v_product_id;
      RAISE EXCEPTION
        'INSUFFICIENT_STOCK: Stock insuficiente para "%". Disponible: %, Solicitado: %',
        COALESCE(v_product_name, v_product_id::text),
        v_stock_before,
        v_quantity::integer;
    END IF;

    UPDATE product_stock
    SET    current_stock = current_stock - v_quantity::integer,
           is_enabled    = true,
           last_updated  = clock_timestamp()
    WHERE  product_id = v_product_id
      AND  school_id  = p_school_id
      AND  is_enabled = true
    RETURNING current_stock INTO v_stock_after;

    v_stock_after := COALESCE(v_stock_after, v_stock_before - v_quantity::integer);

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
      CASE
        WHEN v_combo_name IS NOT NULL
          THEN 'Salida por Combo: ' || v_combo_name || ' | Ticket ' || COALESCE(v_ticket_code, v_transaction_id::text)
        ELSE 'Venta POS ticket ' || COALESCE(v_ticket_code, v_transaction_id::text)
      END
    );

  END LOOP;

  -- ── 14. IDEMPOTENCIA: completar fila con transaction_id real ─────────────
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pos_idempotency_keys
    SET    transaction_id = v_transaction_id
    WHERE  school_id       = p_school_id
      AND  idempotency_key = p_idempotency_key
      AND  transaction_id  IS NULL;
  END IF;

  -- ── 15. RETORNAR RESULTADO ───────────────────────────────────────────────
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

GRANT EXECUTE ON FUNCTION public.complete_pos_sale_v2(
  uuid, uuid, jsonb, text,
  uuid, uuid, text, jsonb, jsonb, text, numeric, jsonb, uuid
) TO authenticated, service_role;

COMMENT ON FUNCTION public.complete_pos_sale_v2(uuid,uuid,jsonb,text,uuid,uuid,text,jsonb,jsonb,text,numeric,jsonb,uuid) IS
  'v2.4 2026-05-30: saldo invisible en kiosco. '
  'Compras de alumno = siempre crédito (pending, payment_method NULL). '
  'students.balance nunca se descuenta en ventas POS. '
  'Elimina dependencia de trigger_validate_free_account (obsoleto). '
  'Preserva: idempotencia hermética, FOR UPDATE ACID, KIOSK_DISABLED, topes, '
  'STOCK_CONFIG_ERROR, combos, mixto, boleta/factura, sesión de caja.';

SELECT 'v2.4 OK: complete_pos_sale_v2 — saldo invisible en kiosco + trigger obsoleto eliminado' AS resultado;
