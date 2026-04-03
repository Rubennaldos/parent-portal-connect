-- ================================================================
-- ADMIN SECURITY PATCH — FASE 2
-- Fecha: 2026-04-03
--
-- V5.2  price_change_log   : historial inmutable de cambios de precio
-- V6.1  pos_stock_movements: Kardex POS (≠ inventory_movements del almacén)
--        · complete_pos_sale_v2 escribe en Kardex en el paso 12
--        · trigger en product_stock captura ajustes manuales
--
-- NOTA: Se usa pos_stock_movements (NO inventory_movements) para no
--       colisionar con el sistema de logística de almacén que ya
--       usa inventory_movements con un esquema distinto.
-- ================================================================

-- =============================================================================
-- PRELUDIO — Columnas garantizadas antes de cualquier función o trigger
-- =============================================================================
DO $$
BEGIN
  -- transaction_items: product_id
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transaction_items')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public'
                       AND table_name='transaction_items'
                       AND column_name='product_id')
  THEN
    EXECUTE 'ALTER TABLE public.transaction_items
             ADD COLUMN product_id uuid REFERENCES public.products(id)';
    RAISE NOTICE 'PRELUDIO: transaction_items.product_id añadida';
  END IF;

  -- transaction_items: is_custom_sale
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transaction_items')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public'
                       AND table_name='transaction_items'
                       AND column_name='is_custom_sale')
  THEN
    EXECUTE 'ALTER TABLE public.transaction_items
             ADD COLUMN is_custom_sale boolean NOT NULL DEFAULT false';
    RAISE NOTICE 'PRELUDIO: transaction_items.is_custom_sale añadida';
  END IF;

  -- products: price_sale (el setup antiguo usaba solo "price")
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='products')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public'
                       AND table_name='products'
                       AND column_name='price_sale')
  THEN
    EXECUTE 'ALTER TABLE public.products ADD COLUMN price_sale numeric(10,2)';
    EXECUTE 'UPDATE public.products SET price_sale = price WHERE price_sale IS NULL';
    RAISE NOTICE 'PRELUDIO: products.price_sale añadida y copiada desde price';
  END IF;

END;
$$;

SELECT 'PRELUDIO ✅ columnas verificadas' AS paso;


-- ================================================================
-- V5.2 — TABLA price_change_log (historial inmutable de precios)
-- ================================================================

CREATE TABLE IF NOT EXISTS price_change_log (
  id           uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id   uuid          NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  school_id    uuid                   REFERENCES schools(id)    ON DELETE SET NULL,
  table_origin text          NOT NULL DEFAULT 'product_school_prices',
  old_price    numeric(10,2) NOT NULL,
  new_price    numeric(10,2) NOT NULL,
  changed_by   uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at   timestamptz   NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_pcl_product
  ON price_change_log (product_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcl_school
  ON price_change_log (school_id,  changed_at DESC);

ALTER TABLE price_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_change_log_select"          ON price_change_log;
DROP POLICY IF EXISTS "price_change_log_insert_blocked"  ON price_change_log;
DROP POLICY IF EXISTS "price_change_log_immutable"       ON price_change_log;

CREATE POLICY "price_change_log_select" ON price_change_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin_general','superadmin')
          OR (
            p.role IN ('gestor_unidad','cajero','operador_caja')
            AND p.school_id = price_change_log.school_id
          )
        )
    )
  );

-- INSERT solo desde triggers SECURITY DEFINER; usuarios directos: bloqueados
CREATE POLICY "price_change_log_insert_blocked" ON price_change_log
  FOR INSERT TO authenticated WITH CHECK (false);

-- UPDATE y DELETE permanentemente bloqueados
CREATE POLICY "price_change_log_immutable" ON price_change_log
  FOR ALL TO authenticated USING (false);

SELECT 'V5.2 ✅ price_change_log creada' AS paso;


-- ================================================================
-- V5.2 — TRIGGER de auditoría en product_school_prices
-- ================================================================

CREATE OR REPLACE FUNCTION fn_log_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.price_sale IS NOT DISTINCT FROM NEW.price_sale THEN
    RETURN NEW;
  END IF;

  INSERT INTO price_change_log (
    product_id, school_id, table_origin,
    old_price,  new_price, changed_by, changed_at
  ) VALUES (
    NEW.product_id, NEW.school_id,
    'product_school_prices',
    OLD.price_sale, NEW.price_sale,
    auth.uid(), clock_timestamp()
  );

  RETURN NEW;
END;
$$;

-- Crear el trigger solo si product_school_prices tiene price_sale y product_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='product_school_prices'
      AND column_name='price_sale'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='product_school_prices'
      AND column_name='product_id'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_log_price_change_school
             ON public.product_school_prices';
    EXECUTE $t$
      CREATE TRIGGER trg_log_price_change_school
        AFTER UPDATE OF price_sale ON public.product_school_prices
        FOR EACH ROW EXECUTE FUNCTION fn_log_price_change()
    $t$;
    RAISE NOTICE 'V5.2: trigger en product_school_prices creado';
  ELSE
    RAISE NOTICE 'V5.2: columnas faltantes en product_school_prices — trigger omitido';
  END IF;
END;
$$;

-- Trigger en la tabla base products (precio global)
CREATE OR REPLACE FUNCTION fn_log_price_change_base()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.price_sale IS NOT DISTINCT FROM NEW.price_sale THEN
    RETURN NEW;
  END IF;

  INSERT INTO price_change_log (
    product_id, school_id, table_origin,
    old_price,  new_price, changed_by, changed_at
  ) VALUES (
    NEW.id, NULL,
    'products',
    OLD.price_sale, NEW.price_sale,
    auth.uid(), clock_timestamp()
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products'
      AND column_name='price_sale'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_log_price_change_base ON public.products';
    EXECUTE $t$
      CREATE TRIGGER trg_log_price_change_base
        AFTER UPDATE OF price_sale ON public.products
        FOR EACH ROW EXECUTE FUNCTION fn_log_price_change_base()
    $t$;
    RAISE NOTICE 'V5.2: trigger en products creado';
  ELSE
    RAISE NOTICE 'V5.2: products.price_sale no encontrada — trigger omitido';
  END IF;
END;
$$;

SELECT 'V5.2 ✅ triggers de auditoría de precios aplicados' AS paso;


-- ================================================================
-- V6.1 — TABLA pos_stock_movements (Kardex POS)
-- ================================================================
-- IMPORTANTE: Esta tabla es DISTINTA de inventory_movements.
-- inventory_movements = sistema de logística de almacén (item_id, from/to_school_id).
-- pos_stock_movements = libro mayor de stock del POS   (product_id, school_id).

CREATE TABLE IF NOT EXISTS pos_stock_movements (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id     uuid        NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  school_id      uuid        NOT NULL REFERENCES schools(id)   ON DELETE CASCADE,
  movement_type  varchar(30) NOT NULL
    CHECK (movement_type IN ('venta_pos','ajuste_manual','entrada_compra')),
  quantity_delta integer     NOT NULL,
  stock_before   integer     NOT NULL,
  stock_after    integer     NOT NULL,
  reference_id   uuid        DEFAULT NULL,
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT chk_psm_delta CHECK (stock_after = stock_before + quantity_delta)
);

CREATE INDEX IF NOT EXISTS idx_psm_product
  ON pos_stock_movements (product_id, school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_psm_reference
  ON pos_stock_movements (reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE pos_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psm_select"           ON pos_stock_movements;
DROP POLICY IF EXISTS "psm_insert_blocked"   ON pos_stock_movements;
DROP POLICY IF EXISTS "psm_immutable"        ON pos_stock_movements;

CREATE POLICY "psm_select" ON pos_stock_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin_general','superadmin')
          OR (
            p.role IN ('gestor_unidad','cajero','operador_caja')
            AND p.school_id = pos_stock_movements.school_id
          )
        )
    )
  );

-- INSERT solo desde RPCs SECURITY DEFINER y triggers
CREATE POLICY "psm_insert_blocked" ON pos_stock_movements
  FOR INSERT TO authenticated WITH CHECK (false);

-- UPDATE / DELETE permanentemente bloqueados
CREATE POLICY "psm_immutable" ON pos_stock_movements
  FOR ALL TO authenticated USING (false);

SELECT 'V6.1 ✅ pos_stock_movements creada' AS paso;


-- ================================================================
-- V6.1 — TRIGGER en product_stock (captura ajustes manuales)
-- ================================================================

CREATE OR REPLACE FUNCTION fn_log_stock_manual_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.current_stock = NEW.current_stock THEN
    RETURN NEW;
  END IF;

  -- Si el cambio viene del RPC del POS, omitir (el RPC registra con más contexto)
  IF current_setting('app.kardex_source', true) = 'pos_rpc' THEN
    RETURN NEW;
  END IF;

  INSERT INTO pos_stock_movements (
    product_id,    school_id,
    movement_type, quantity_delta,
    stock_before,  stock_after,
    reference_id,  created_by,
    created_at
  ) VALUES (
    OLD.product_id, OLD.school_id,
    'ajuste_manual',
    NEW.current_stock - OLD.current_stock,
    OLD.current_stock, NEW.current_stock,
    NULL, auth.uid(),
    clock_timestamp()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_stock_manual_adjustment ON product_stock;
CREATE TRIGGER trg_log_stock_manual_adjustment
  AFTER UPDATE OF current_stock ON product_stock
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_stock_manual_adjustment();

SELECT 'V6.1 ✅ trigger de ajuste_manual en product_stock creado' AS paso;


-- ================================================================
-- ACTUALIZAR complete_pos_sale_v2 — Integrar Kardex en Paso 12
-- Idéntico al último parche de seguridad salvo el paso 12 que ahora
-- inserta en pos_stock_movements (no en inventory_movements).
-- ================================================================

DROP FUNCTION IF EXISTS complete_pos_sale_v2(
  uuid, uuid, jsonb, text,
  uuid, uuid, text, jsonb, jsonb, text, numeric, jsonb, uuid
);

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
  v_stock_before   integer;

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

  -- ── 0a. IDENTIDAD (V1.1 + V1.2) ────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: No hay sesión autenticada.';
  END IF;

  SELECT role, school_id INTO v_caller_role, v_caller_school
  FROM profiles WHERE id = v_caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Perfil no encontrado (uid: %).', v_caller_id;
  END IF;

  IF v_caller_role NOT IN ('admin_general','superadmin','gestor_unidad','cajero','operador_caja') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: El rol "%" no tiene acceso al POS.', v_caller_role;
  END IF;

  IF v_caller_role NOT IN ('admin_general','superadmin') THEN
    IF v_caller_school IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'UNAUTHORIZED_SCHOOL: Tu sede (%) no coincide con la sede de la venta (%).',
        v_caller_school, p_school_id;
    END IF;
  END IF;

  -- ── 0b. VENTA LIBRE (V1.3) ──────────────────────────────────────
  IF v_caller_role NOT IN ('admin_general','superadmin') THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) elem
      WHERE COALESCE((elem->>'is_custom')::boolean, false) = true
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED_CUSTOM_SALE: Solo administradores pueden registrar ventas libres.';
    END IF;
  END IF;

  -- ── 0c. SESIÓN DE CAJA (V4.2) ───────────────────────────────────
  IF p_cash_session_id IS NOT NULL THEN
    SELECT id INTO v_effective_session_id
    FROM cash_sessions
    WHERE id = p_cash_session_id AND school_id = p_school_id AND status = 'open';

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
    WHERE school_id = p_school_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

    IF NOT FOUND THEN
      IF v_caller_role IN ('admin_general','superadmin') THEN
        v_effective_session_id := NULL;
      ELSE
        RAISE EXCEPTION 'NO_OPEN_SESSION: No hay sesión de caja abierta para esta sede.';
      END IF;
    END IF;
  END IF;

  -- ── 1. FECHA OPERATIVA Lima ──────────────────────────────────────
  v_sale_date := (timezone('America/Lima', clock_timestamp()))::date;

  -- ── 2. BLOQUEAR ALUMNO ──────────────────────────────────────────
  IF p_client_mode = 'student' AND p_student_id IS NOT NULL THEN
    SELECT s.balance, s.free_account, s.kiosk_disabled
    INTO v_current_balance, v_is_free_account, v_kiosk_disabled
    FROM students s WHERE s.id = p_student_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND: Alumno no encontrado (id: %)', p_student_id;
    END IF;
    IF v_kiosk_disabled THEN
      RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado.';
    END IF;
  END IF;

  -- ── 3. BLOQUEAR product_stock (UUID ascendente para evitar deadlocks) ──
  PERFORM ps.product_id
  FROM product_stock ps
  JOIN products p ON p.id = ps.product_id
  WHERE ps.school_id = p_school_id
    AND ps.is_enabled = true
    AND p.stock_control_enabled = true
    AND ps.product_id = ANY (
      ARRAY(
        SELECT (elem->>'product_id')::uuid
        FROM jsonb_array_elements(p_lines) elem
        WHERE NOT COALESCE((elem->>'is_custom')::boolean, false)
          AND (elem->>'product_id') IS NOT NULL
      )
    )
  ORDER BY ps.product_id
  FOR UPDATE OF ps;

  -- ── 4. RESOLVER PRECIOS + VALIDAR STOCK ─────────────────────────
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

  -- ── 5. VALIDAR SALDO / MODO DE PAGO ────────────────────────────
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

  -- ── 6. FLAGS DE FACTURACIÓN ──────────────────────────────────────
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

  -- ── 7. PAGO MIXTO + VALIDACIÓN SUMA (V2.1) ──────────────────────
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

    IF round(v_cash_amount + v_card_amount + v_yape_amount, 2) != v_total THEN
      RAISE EXCEPTION 'SPLITS_MISMATCH: Suma del pago mixto (S/ %) ≠ total (S/ %).',
        round(v_cash_amount + v_card_amount + v_yape_amount, 2), v_total;
    END IF;
  END IF;

  -- ── 8. NÚMERO DE TICKET ─────────────────────────────────────────
  SELECT get_next_ticket_number(v_caller_id) INTO v_ticket_code;

  -- ── 9. INSERTAR TRANSACCIÓN ─────────────────────────────────────
  v_eff_method := CASE
    WHEN p_client_mode = 'student' THEN
      CASE WHEN v_should_use_balance THEN COALESCE(p_payment_method,'saldo') ELSE NULL END
    WHEN p_client_mode = 'teacher' THEN NULL
    ELSE COALESCE(p_payment_method,'efectivo')
  END;

  INSERT INTO transactions (
    student_id, teacher_id, school_id,
    type, amount, description,
    balance_after, created_by, ticket_code,
    payment_status, payment_method, metadata,
    paid_with_mixed, cash_amount, card_amount, yape_amount,
    document_type, invoice_client_name, invoice_client_dni_ruc,
    is_taxable, billing_status,
    cash_session_id, created_at
  ) VALUES (
    CASE WHEN p_client_mode='student' THEN p_student_id ELSE NULL END,
    CASE WHEN p_client_mode='teacher' THEN p_teacher_id ELSE NULL END,
    p_school_id, 'purchase', -v_total,
    CASE
      WHEN p_client_mode='student' AND v_should_use_balance
        THEN 'Compra POS (Saldo) - S/ '                || v_total::text
      WHEN p_client_mode='student'
        THEN 'Compra POS (Cuenta Libre - Deuda) - S/ ' || v_total::text
      WHEN p_client_mode='teacher'
        THEN 'Compra Profesor - '        || jsonb_array_length(p_lines)::text || ' items'
      ELSE 'Compra Cliente Genérico - '  || jsonb_array_length(p_lines)::text || ' items'
    END,
    v_balance_after, v_caller_id, v_ticket_code,
    v_payment_status, v_eff_method,
    COALESCE(p_payment_metadata,'{}') || jsonb_build_object('source','pos'),
    v_is_mixed, v_cash_amount, v_card_amount, v_yape_amount,
    v_doc_type,
    p_billing_data->>'client_name',
    p_billing_data->>'client_dni_ruc',
    v_is_taxable, v_billing_status,
    v_effective_session_id, clock_timestamp()
  )
  RETURNING id INTO v_transaction_id;

  -- ── 10. INSERTAR TRANSACTION_ITEMS ──────────────────────────────
  INSERT INTO transaction_items (
    transaction_id, product_id, product_name,
    quantity, unit_price, subtotal, is_custom_sale
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

  -- ── 11. INSERTAR SALES ──────────────────────────────────────────
  INSERT INTO sales (
    transaction_id, student_id, teacher_id, school_id, cashier_id,
    total, subtotal, discount, payment_method,
    cash_received, change_given, items
  ) VALUES (
    v_transaction_id,
    CASE WHEN p_client_mode='student' THEN p_student_id ELSE NULL END,
    CASE WHEN p_client_mode='teacher' THEN p_teacher_id ELSE NULL END,
    p_school_id, v_caller_id,
    v_total, v_total, 0,
    CASE
      WHEN p_client_mode='student' THEN
        CASE WHEN v_should_use_balance
          THEN COALESCE(p_payment_method,'saldo')
          ELSE 'debt'
        END
      WHEN p_client_mode='teacher' THEN 'teacher_account'
      ELSE CASE p_payment_method
             WHEN 'efectivo'      THEN 'cash'
             WHEN 'tarjeta'       THEN 'card'
             WHEN 'transferencia' THEN 'transfer'
             WHEN 'yape_qr'       THEN 'yape'
             WHEN 'yape_numero'   THEN 'yape'
             WHEN 'plin_qr'       THEN 'plin'
             WHEN 'plin_numero'   THEN 'plin'
             WHEN 'mixto'         THEN 'mixto'
             WHEN 'mixed'         THEN 'mixto'
             ELSE COALESCE(p_payment_method,'cash')
           END
    END,
    CASE
      WHEN p_client_mode='generic'
       AND (p_payment_method='efectivo' OR p_payment_method IS NULL)
      THEN COALESCE(p_cash_given, v_total) ELSE NULL
    END,
    CASE
      WHEN p_client_mode='generic'
       AND (p_payment_method='efectivo' OR p_payment_method IS NULL)
      THEN COALESCE(p_cash_given, v_total) - v_total ELSE NULL
    END,
    v_line_items
  );

  -- ── 12. DESCONTAR STOCK + REGISTRAR EN KARDEX (pos_stock_movements) ─
  PERFORM set_config('app.kardex_source', 'pos_rpc', true);

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_lines) AS value LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := (v_elem->>'quantity')::numeric;

    IF NOT v_is_custom AND v_product_id IS NOT NULL THEN

      SELECT current_stock INTO v_stock_before
      FROM product_stock
      WHERE product_id = v_product_id
        AND school_id  = p_school_id
        AND is_enabled = true;

      UPDATE product_stock
      SET current_stock = current_stock - v_quantity,
          last_updated  = clock_timestamp()
      WHERE product_id = v_product_id
        AND school_id  = p_school_id
        AND is_enabled = true;

      INSERT INTO pos_stock_movements (
        product_id, school_id,
        movement_type, quantity_delta,
        stock_before,  stock_after,
        reference_id,  created_by, created_at
      ) VALUES (
        v_product_id, p_school_id,
        'venta_pos', -(v_quantity::integer),
        v_stock_before, v_stock_before - v_quantity::integer,
        v_transaction_id, v_caller_id, clock_timestamp()
      );

    END IF;
  END LOOP;

  -- ── 13. REGISTRAR CLAVE DE IDEMPOTENCIA ─────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO pos_idempotency_keys (school_id, idempotency_key, transaction_id)
    VALUES (p_school_id, p_idempotency_key, v_transaction_id)
    ON CONFLICT (school_id, idempotency_key) DO NOTHING;
  END IF;

  -- ── 14. RESULTADO ───────────────────────────────────────────────
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

SELECT 'V6.1 + RPC ✅ complete_pos_sale_v2 con Kardex (pos_stock_movements) aplicado' AS paso;


-- ================================================================
-- VERIFICACIÓN FINAL
-- ================================================================
SELECT
  '20260403_admin_security_patch_p2'                                AS migracion,
  'V5.2 — price_change_log + triggers de auditoría de precios'      AS parche
UNION ALL SELECT '20260403_admin_security_patch_p2',
  'V6.1 — pos_stock_movements (Kardex POS, distinto de inventory_movements)'
UNION ALL SELECT '20260403_admin_security_patch_p2',
  'V6.1 — trigger ajuste_manual en product_stock'
UNION ALL SELECT '20260403_admin_security_patch_p2',
  'V6.1 — complete_pos_sale_v2: registra venta_pos en pos_stock_movements';
