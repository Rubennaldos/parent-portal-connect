-- ============================================================
-- INVENTORY BRAIN & WALL REENGINEERING
-- ============================================================
-- Objetivo:
-- 1) Estandarizar configuración en app_settings (deprecación segura de app_config)
-- 2) Muralla final: trigger en product_stock guiado por switch global
-- 3) Cerebro POS: complete_pos_sale_v2 valida switch y emite mensaje amigable
-- 4) Buscador Stock Live V2 con unaccent + ilike + pg_trgm
-- ============================================================

-- ── 1) Estandarización de configuración global ──────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION fn_touch_app_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_touch_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION fn_touch_app_settings_updated_at();

DO $$
DECLARE
  v_allow_negative boolean := false;
BEGIN
  IF to_regclass('public.app_config') IS NOT NULL THEN
    SELECT COALESCE((ac.value_json->>'enabled')::boolean, false)
    INTO   v_allow_negative
    FROM   app_config ac
    WHERE  ac.key = 'allow_negative_sales'
    LIMIT 1;
  END IF;

  INSERT INTO app_settings (key, value, description)
  VALUES (
    'allow_negative_stock',
    jsonb_build_object('enabled', COALESCE(v_allow_negative, false)),
    'Master switch global para permitir o bloquear stock negativo'
  )
  ON CONFLICT (key) DO UPDATE
  SET
    value       = EXCLUDED.value,
    description = COALESCE(app_settings.description, EXCLUDED.description),
    updated_at  = clock_timestamp();
END;
$$;

COMMENT ON TABLE app_settings IS 'Configuraciones globales del sistema (fuente actual).';

DO $$
BEGIN
  IF to_regclass('public.app_config') IS NOT NULL THEN
    EXECUTE 'COMMENT ON TABLE app_config IS ''DEPRECATED: mantener temporalmente por compatibilidad del sprint.''';
  END IF;
END;
$$;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_read_auth" ON app_settings;
DROP POLICY IF EXISTS "app_settings_write_admin_general_only" ON app_settings;

CREATE POLICY "app_settings_read_auth" ON app_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "app_settings_write_admin_general_only" ON app_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin_general'
    )
  );

CREATE OR REPLACE FUNCTION get_allow_negative_stock()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (s.value->>'enabled')::boolean
      FROM app_settings s
      WHERE s.key = 'allow_negative_stock'
      LIMIT 1
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION get_allow_negative_stock() TO authenticated, service_role;

-- ── 2) Muralla final: guardrail de stock negativo por switch ────────────────
CREATE OR REPLACE FUNCTION fn_guard_product_stock_negative_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_negative boolean := false;
BEGIN
  v_allow_negative := COALESCE(get_allow_negative_stock(), false);

  IF NOT v_allow_negative AND NEW.current_stock < 0 THEN
    RAISE EXCEPTION 'STOCK_BLOQUEADO: Venta en negativo desactivada.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_product_stock_by_switch ON product_stock;
DROP TRIGGER IF EXISTS trg_guard_product_stock_non_negative ON product_stock;

CREATE TRIGGER trg_guard_product_stock_negative_switch
  BEFORE INSERT OR UPDATE OF current_stock ON product_stock
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_product_stock_negative_switch();

-- ── 3) Cerebro de negocio: complete_pos_sale_v2 ────────────────────────────
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

  v_current_balance   numeric;
  v_is_free_account   boolean;
  v_kiosk_disabled    boolean;
  v_should_use_balance boolean;
  v_balance_after     numeric := 0;

  v_has_stock_ctrl     boolean;
  v_current_stock      integer;
  v_allow_negative_stock boolean := false;

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
  v_sale_date := (timezone('America/Lima', clock_timestamp()))::date;
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
        WHERE  p.id = v_product_id
          AND  p.active = true;

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
      WHERE id = p_cash_session_id
        AND school_id = p_school_id
        AND status = 'open'
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

  -- ── 13. DESCONTAR STOCK ──────────────────────────────────────────
  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(p_lines) AS value
  LOOP
    v_is_custom  := COALESCE((v_elem->>'is_custom')::boolean, false);
    v_product_id := (v_elem->>'product_id')::uuid;
    v_quantity   := (v_elem->>'quantity')::numeric;

    IF NOT v_is_custom AND v_product_id IS NOT NULL THEN
      UPDATE product_stock ps
      SET    current_stock = ps.current_stock - v_quantity,
             last_updated  = clock_timestamp()
      FROM   products p
      WHERE  ps.product_id = v_product_id
        AND  ps.product_id = p.id
        AND  ps.school_id  = p_school_id
        AND  ps.is_enabled = true
        AND  p.stock_control_enabled = true;
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

-- ── 4) Stock Live V2: búsqueda profesional y orden por urgencia ────────────
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Wrapper IMMUTABLE sobre unaccent para poder usarlo en expresiones de índice.
-- PostgreSQL requiere IMMUTABLE en índices; unaccent() nativa es STABLE.
CREATE OR REPLACE FUNCTION f_unaccent(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT public.unaccent('public.unaccent', t);
$$;

-- Índices GIN trgm para búsqueda veloz (nombre, categoría, sede)
CREATE INDEX IF NOT EXISTS idx_products_name_unaccent_trgm
  ON products
  USING gin (f_unaccent(lower(COALESCE(name, ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_category_unaccent_trgm
  ON products
  USING gin (f_unaccent(lower(COALESCE(category, ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_schools_name_unaccent_trgm
  ON schools
  USING gin (f_unaccent(lower(COALESCE(name, ''))) gin_trgm_ops);

CREATE OR REPLACE FUNCTION get_live_stock_v2(
  p_query     text DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_estado    text DEFAULT NULL,
  p_limit     integer DEFAULT 1000
)
RETURNS TABLE (
  product_id      uuid,
  school_id       uuid,
  nombre_producto text,
  categoria       text,
  sede            text,
  stock_actual    integer,
  min_stock       integer,
  estado          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      NULLIF(trim(COALESCE(p_query, '')), '')                    AS raw_term,
      f_unaccent(lower(trim(COALESCE(p_query, ''))))             AS norm_term
  )
  SELECT
    p.id                                                         AS product_id,
    s.id                                                         AS school_id,
    p.name                                                       AS nombre_producto,
    COALESCE(NULLIF(trim(p.category), ''), 'Sin categoría')      AS categoria,
    s.name                                                       AS sede,
    ps.current_stock                                             AS stock_actual,
    COALESCE(p.min_stock, 0)                                     AS min_stock,
    CASE
      WHEN ps.current_stock <= 0                                   THEN 'Agotado'
      WHEN ps.current_stock < COALESCE(p.min_stock, 0)            THEN 'Bajo Stock'
      ELSE 'OK'
    END                                                          AS estado
  FROM product_stock ps
  JOIN products p ON p.id = ps.product_id
  JOIN schools  s ON s.id = ps.school_id
  CROSS JOIN q
  WHERE p.active     = true
    AND ps.is_enabled = true
    AND (p_school_id IS NULL OR ps.school_id = p_school_id)
    AND (
      q.raw_term IS NULL
      OR f_unaccent(lower(COALESCE(p.name,     ''))) ILIKE '%' || q.norm_term || '%'
      OR f_unaccent(lower(COALESCE(p.category, ''))) ILIKE '%' || q.norm_term || '%'
      OR f_unaccent(lower(COALESCE(s.name,     ''))) ILIKE '%' || q.norm_term || '%'
    )
    AND (
      p_estado IS NULL
      OR p_estado = ''
      OR (
        CASE
          WHEN ps.current_stock <= 0                                THEN 'Agotado'
          WHEN ps.current_stock < COALESCE(p.min_stock, 0)         THEN 'Bajo Stock'
          ELSE 'OK'
        END
      ) = p_estado
    )
  ORDER BY
    ps.current_stock ASC,
    p.name           ASC,
    s.name           ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
$$;

GRANT EXECUTE ON FUNCTION get_live_stock_v2(text, uuid, text, integer)
  TO authenticated, service_role;

SELECT 'INVENTORY BRAIN & WALL REENGINEERING OK' AS resultado;
