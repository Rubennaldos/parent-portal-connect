-- ============================================================================
-- PARCHE DE SEGURIDAD POS — 3 cierres críticos
-- Fecha: 2026-05-29
-- ============================================================================
--
-- FIX 1 › complete_pos_sale_v2: Idempotencia hermética al inicio
--   Patrón anterior (CHECK at start):
--     SELECT key → si existe retorna; si no, sigue y hace INSERT al final.
--     Ventana de concurrencia: dos requests con misma key pasan el SELECT
--     simultáneamente y ambos terminan procesando la venta.
--   Patrón nuevo (CLAIM at start):
--     INSERT key con transaction_id=NULL al inicio.
--     Si UNIQUE conflict (0 rows) → el segundo request espera al primero y
--     retorna idempotent_hit con el transaction_id real ya guardado.
--     Si el primero hace rollback → la key también se revierte y el segundo
--     puede reclamarla limpiamente.
--     Al final se hace UPDATE con el transaction_id real (no INSERT).
--
-- FIX 2 › complete_pos_sale_v2: Error estricto si producto sin stock configurado
--   Anterior: CONTINUE silencioso cuando no existe fila en product_stock.
--   Nuevo: si el switch de negativos está OFF y el producto tiene
--     products.stock_control_enabled = true pero no tiene fila activa
--     en product_stock para la sede, lanza STOCK_CONFIG_ERROR.
--   Combos quedan exentos (sus componentes ya se validan en paso 3b).
--
-- FIX 3 › cancel_pos_sale: Restauración de stock desde Kardex
--   Anterior: lee transaction_items, donde los combos tienen product_id NULL
--     → los componentes del combo nunca se devuelven al inventario.
--   Nuevo: lee pos_stock_movements WHERE reference_id = transaction_id AND
--     movement_type = 'venta_pos'. Esas filas contienen los productos reales
--     descontados (incluyendo cada componente de combo), con sus cantidades
--     exactas en integer. Reversión perfecta y sin ambigüedad.
--   Extra: añade validación de school_id para roles distintos de admin_general
--     y superadmin (vector de anulación cruzada de sede).
--
-- REGLAS PRESERVADAS INTACTAS:
--   - FOR UPDATE en students y product_stock (sin JOIN)
--   - SUNAT_INTEGRITY (cancel_pos_sale)
--   - tg_enforce_spending_limit (BEFORE INSERT en transactions)
--   - fn_sync_student_balance / trg_transactions_balance_sync
--   - chk_psm_delta en pos_stock_movements
--   - Toda la lógica de combos, mixto, boleta/factura, sesión de caja
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 1 / 2 — complete_pos_sale_v2 (FIX 1 + FIX 2)
-- Base: 20260528_hotfix_complete_pos_sale_v2_for_update.sql (versión actual)
-- Cambios marcados con «FIX 1» y «FIX 2»
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.complete_pos_sale_v2(uuid,uuid,jsonb,text,uuid,uuid,text,jsonb,jsonb,text,numeric,jsonb,uuid);

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

  -- «FIX 1» contador para el INSERT de idempotencia al inicio
  v_idem_rows   integer;
BEGIN

  -- ── 0. IDEMPOTENCIA — «FIX 1: claim al INICIO, UPDATE al FINAL» ──────────
  --
  -- Patrón antiguo:  SELECT key → si ya existe retornar  (ventana de carrera).
  -- Patrón nuevo:    INSERT key con NULL transaction_id.  Si UNIQUE conflict
  --                  (0 rows) → el segundo request esperó al primero en el lock
  --                  de la constraint y ahora lee el UUID real → idempotent_hit.
  --                  Si el primero hace rollback → key también se revierte y el
  --                  segundo puede reclamarla limpiamente.
  --
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO pos_idempotency_keys (school_id, idempotency_key, transaction_id)
    VALUES (p_school_id, p_idempotency_key, NULL)
    ON CONFLICT (school_id, idempotency_key) DO NOTHING;

    GET DIAGNOSTICS v_idem_rows = ROW_COUNT;

    IF v_idem_rows = 0 THEN
      -- Conflicto: la clave ya estaba reclamada por otro request que
      -- ganó la carrera. Leer el resultado final (puede ser UUID si el
      -- primero ya terminó, o NULL si todavía está procesando).
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
  -- REGLA: FOR UPDATE sobre tabla directa (students), SIN ningún JOIN.
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
  -- REGLA: FOR UPDATE OF ps sobre tabla DIRECTA, SIN LEFT JOIN.
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
  -- Solo lectura, SIN FOR UPDATE.
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
  -- Solo lectura, SIN FOR UPDATE.
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

      -- Solo lectura: LEFT JOIN SIN FOR UPDATE.
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

  -- ── 5. VALIDAR SALDO Y DEFINIR MODO DE PAGO ─────────────────────────────
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

  -- ── 6. FLAGS DE FACTURACIÓN ──────────────────────────────────────────────
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
  v_eff_method := CASE
    WHEN p_client_mode = 'student' THEN
      CASE WHEN v_should_use_balance THEN COALESCE(p_payment_method, 'saldo') ELSE NULL END
    WHEN p_client_mode = 'teacher' THEN NULL
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

  -- ── 13. DESCONTAR STOCK + KARDEX venta_pos ───────────────────────────────
  -- «FIX 2» añadido al bloque IF NOT v_has_stock_ctrl.
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
      -- «FIX 2»: si el switch de negativos está OFF y el producto tiene
      -- stock_control_enabled = true en catálogo pero no tiene fila activa
      -- en product_stock para esta sede → error de configuración, no silencio.
      -- Combos exentos: sus componentes ya fueron validados en paso 3b.
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

    -- REGLA: FOR UPDATE sobre tabla directa, SIN LEFT JOIN.
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
  -- «FIX 1»: reemplaza el INSERT ... ON CONFLICT DO NOTHING del final.
  -- La fila ya existe (creada al inicio con NULL); solo actualizamos el UUID.
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
  'v2.3 2026-05-29: idempotencia hermética al inicio (FIX 1: INSERT-claim), '
  'error estricto STOCK_CONFIG_ERROR si producto con control activo sin fila de stock (FIX 2). '
  'Preserva: FOR UPDATE sin JOIN, ACID, topes, combos, boleta/factura, sesión de caja.';

SELECT 'FIX 1+2 OK: complete_pos_sale_v2 v2.3 — idempotencia hermética + STOCK_CONFIG_ERROR' AS resultado;


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 2 / 2 — cancel_pos_sale (FIX 3 + validación de sede)
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.cancel_pos_sale(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.cancel_pos_sale(
  p_transaction_id uuid,
  p_admin_id       uuid,
  p_reason         text    DEFAULT 'Anulación de venta desde POS',
  p_refund_method  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id       uuid;
  v_actor_role     text;
  v_actor_school   uuid;   -- para validación de sede por rol
  v_tx             transactions%ROWTYPE;
  v_item           record;
  v_stock_before   integer;
  v_stock_after    integer;
  v_rows_updated   integer;
  v_items_restored integer := 0;
BEGIN

  -- ── 1. Autenticación ─────────────────────────────────────────────────────
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_actor_id <> p_admin_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED: p_admin_id no coincide con auth.uid().'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 2. Autorización por rol + captura de sede ─────────────────────────────
  SELECT p.role, p.school_id
  INTO   v_actor_role, v_actor_school
  FROM   profiles p
  WHERE  p.id = v_actor_id;

  IF v_actor_role NOT IN (
    'admin_general', 'superadmin', 'gestor_unidad', 'admin_sede',
    'cajero', 'operador_caja'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Rol % no autorizado para esta operación.', v_actor_role
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 3. Bloqueo y lectura de la transacción ────────────────────────────────
  SELECT * INTO v_tx
  FROM transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: La transacción % no existe.', p_transaction_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 4. Control de sede (admin_general / superadmin quedan exentos) ────────
  IF v_actor_role NOT IN ('admin_general', 'superadmin')
     AND v_tx.school_id IS DISTINCT FROM v_actor_school THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: No puede anular ventas de otra sede.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 5. Validaciones de estado ─────────────────────────────────────────────
  IF COALESCE(v_tx.is_deleted, false) THEN
    RAISE EXCEPTION 'INVALID_STATE: La transacción está eliminada lógicamente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.payment_status = 'cancelled' THEN
    RAISE EXCEPTION 'IDEMPOTENT_ABORT: La venta ya fue cancelada anteriormente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.billing_status = 'sent' THEN
    RAISE EXCEPTION
      'SUNAT_INTEGRITY: Esta venta tiene un comprobante enviado a SUNAT. '
      'Use el flujo de Nota de Crédito desde el módulo de facturación.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 6. Marcar la transacción como cancelada ───────────────────────────────
  UPDATE transactions
  SET
    payment_status = 'cancelled',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by',        v_actor_id::text,
      'cancelled_at',        to_char(timezone('America/Lima', now()), 'YYYY-MM-DD"T"HH24:MI:SS'),
      'cancellation_reason', p_reason,
      'refund_method',       p_refund_method,
      'void_source',         'cancel_pos_sale'
    )
  WHERE id = p_transaction_id
    AND payment_status <> 'cancelled';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'CONCURRENT_ABORT: La fila cambió durante el proceso. Intenta nuevamente.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 7. Devolución de stock — «FIX 3: leer del Kardex, no de transaction_items» ──
  --
  -- transaction_items guarda el resumen de línea de la venta; para combos,
  -- el product_id es NULL (el ítem es la línea "combo X S/ Y") y los componentes
  -- no aparecen allí con sus UUIDs individuales.
  --
  -- pos_stock_movements con movement_type='venta_pos' y reference_id=transaction_id
  -- contiene UNA fila por CADA producto físico descontado, incluyendo cada
  -- componente de combo, con quantity_delta negativo y la cantidad exacta en integer.
  -- Revertir esas filas garantiza una reversión 1:1 del descuento original.
  --
  FOR v_item IN
    SELECT
      psm.product_id,
      ABS(psm.quantity_delta)              AS qty,
      COALESCE(p.name, psm.reason)         AS product_name
    FROM  pos_stock_movements psm
    LEFT  JOIN products p ON p.id = psm.product_id
    WHERE psm.reference_id  = p_transaction_id
      AND psm.movement_type = 'venta_pos'
      AND psm.product_id    IS NOT NULL
  LOOP

    -- Solo devolver si la fila de stock sigue activa para la sede
    IF NOT EXISTS (
      SELECT 1
      FROM   product_stock ps
      WHERE  ps.product_id = v_item.product_id
        AND  ps.school_id  = v_tx.school_id
        AND  ps.is_enabled = true
    ) THEN
      CONTINUE;
    END IF;

    -- Devolver unidades y capturar antes/después en una sola operación
    -- (stock_before = current_stock antes de sumar; stock_after = después).
    -- La constraint chk_psm_delta exige stock_after = stock_before + quantity_delta.
    UPDATE product_stock
    SET
      current_stock = current_stock + v_item.qty,
      last_updated  = clock_timestamp()
    WHERE  product_id = v_item.product_id
      AND  school_id  = v_tx.school_id
      AND  is_enabled = true
    RETURNING
      current_stock - v_item.qty,   -- stock_before (valor antes de la suma)
      current_stock                 -- stock_after  (valor tras la suma)
    INTO v_stock_before, v_stock_after;

    -- Registrar en Kardex: movimiento inverso a la venta original
    INSERT INTO pos_stock_movements (
      product_id,
      school_id,
      movement_type,
      quantity_delta,
      stock_before,
      stock_after,
      reference_id,
      created_by,
      created_at,
      reason
    ) VALUES (
      v_item.product_id,
      v_tx.school_id,
      'ajuste_manual',
      v_item.qty,                   -- positivo: ingreso de stock (devolución)
      v_stock_before,
      v_stock_after,
      p_transaction_id,             -- referencia a la transacción anulada
      v_actor_id,
      clock_timestamp(),
      'Anulación de venta desde POS - ' || COALESCE(v_item.product_name, 'Producto')
    );

    v_items_restored := v_items_restored + 1;
  END LOOP;

  -- ── 8. Respuesta ──────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',        true,
    'transaction_id', p_transaction_id,
    'items_restored', v_items_restored
  );

END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pos_sale(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_pos_sale(uuid, uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_pos_sale(uuid, uuid, text, text) IS
  'v1.1 2026-05-29 (FIX 3): restaura stock desde pos_stock_movements(venta_pos) '
  'en lugar de transaction_items → cubre combos y cantidades exactas. '
  'Añade validación de school_id por rol. '
  'NO modifica sales.payment_method ni students.balance (devolución es manual).';

SELECT 'FIX 3 OK: cancel_pos_sale v1.1 — stock desde Kardex + validación de sede' AS resultado;
