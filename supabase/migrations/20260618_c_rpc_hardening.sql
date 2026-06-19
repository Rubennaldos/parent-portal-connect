-- ============================================================================
-- RPC HARDENING v1.9.2 — Fecha: 2026-06-18
--
-- PROBLEMA 1: DELIVER_DUPLICATE destructivo en cocina (red 3G inestable)
-- ─────────────────────────────────────────────────────────────────────────
-- Escenario real:
--   1. Cajero presiona "Confirmar". La petición llega a Postgres y el INSERT
--      se ejecuta correctamente (lunch_order + transaction creados).
--   2. La red cae ANTES de que el servidor devuelva "200 OK".
--   3. El celular muestra "Network Error". El cajero presiona Confirmar de nuevo.
--   4. Segunda llamada → unique_violation en idx_lunch_orders_unique_*active.
--   5. La versión anterior lanzaba RAISE EXCEPTION 'DELIVER_DUPLICATE'.
--      → El frontend recibía un error → toast de error → cajero confundido.
--      → Posible intento manual de creación por otra vía → duplicado real.
--
-- FIX: En lugar de lanzar excepción, recuperar el order_id del pedido que ya
-- existe y devolverlo como si fuera éxito (idempotencia real).
-- El campo "idempotent: true" en el retorno lo distingue para debugging.
--
-- PROBLEMA 2: pg_advisory_xact_lock sin timeout bajo carga de 8AM
-- ─────────────────────────────────────────────────────────────────────────
-- fn_sync_student_balance usa pg_advisory_xact_lock(hash_student_id).
-- Sin lock_timeout, si el lock está tomado, la transacción ESPERA INDEFINIDAMENTE
-- sosteniendo la conexión del pool de pgBouncer. Con 150 padres simultáneos
-- y Small compute (~60 conexiones via pgBouncer), esto colapsa el pool.
--
-- FIX: SET LOCAL lock_timeout = '4s' en las dos RPCs de alto tráfico.
-- Si no se puede adquirir el lock en 4s → error inmediato → conexión liberada
-- → el padre recibe toast de "reintentar" en lugar de timeout infinito.
-- Valor de 4s: más largo que un lock normal (<50ms) pero corto ante una
-- conexión colgada. Se puede ajustar según observación de logs en producción.
--
-- SET LOCAL statement_timeout = '20s': límite global por llamada RPC. Si la
-- función completa no termina en 20s (nunca debería), Postgres la cancela y
-- libera todos los locks y la conexión. Red de seguridad final.
--
-- NOTA: SET LOCAL scope = transacción actual. En PL/pgSQL llamado como RPC,
-- cada llamada es una transacción separada → los timeouts son por llamada.
-- ============================================================================

BEGIN;

-- ── 1. create_and_deliver_lunch_order — DELIVER_DUPLICATE silencioso ─────────

CREATE OR REPLACE FUNCTION public.create_and_deliver_lunch_order(
  p_person_type    TEXT,
  p_person_id      UUID,
  p_order_date     DATE,
  p_category_id    UUID,
  p_menu_id        UUID,
  p_school_id      UUID,
  p_price          NUMERIC,
  p_created_by     UUID,
  p_description    TEXT,
  p_category_name  TEXT DEFAULT 'Almuerzo',
  p_payment_method TEXT DEFAULT 'credit'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order_id       UUID;
  v_tx_id          UUID;
  v_student_id     UUID := NULL;
  v_teacher_id     UUID := NULL;
  v_payment_status TEXT;
  v_payment_col    TEXT;
BEGIN
  -- Timeouts defensivos: evitan conexiones colgadas en el pool de pgBouncer.
  -- lock_timeout: si pg_advisory_xact_lock no puede adquirirse en 4s, falla rápido.
  -- statement_timeout: límite absoluto de toda la función.
  SET LOCAL lock_timeout     = '4s';
  SET LOCAL statement_timeout = '20s';

  IF p_person_type = 'student' THEN
    v_student_id := p_person_id;
  ELSIF p_person_type = 'teacher' THEN
    v_teacher_id := p_person_id;
  ELSE
    RAISE EXCEPTION 'CREATE_AND_DELIVER_INVALID_TYPE: p_person_type debe ser ''student'' o ''teacher''. Recibido: %', p_person_type;
  END IF;

  IF lower(p_payment_method) IN ('cash', 'yape') THEN
    v_payment_status := 'paid';
  ELSE
    v_payment_status := 'pending';
  END IF;

  IF lower(p_payment_method) = 'cash' THEN
    v_payment_col := 'cash';
  ELSIF lower(p_payment_method) = 'yape' THEN
    v_payment_col := 'yape';
  ELSE
    v_payment_col := NULL;
  END IF;

  -- ── INSERT atómico (lunch_order + transaction) ──────────────────────────────
  BEGIN
    INSERT INTO public.lunch_orders (
      student_id, teacher_id, order_date, status,
      category_id, menu_id, school_id, quantity,
      base_price, addons_total, final_price,
      created_by, is_no_order_delivery,
      delivered_at, delivered_by
    )
    VALUES (
      v_student_id, v_teacher_id, p_order_date, 'delivered',
      p_category_id, p_menu_id, p_school_id, 1,
      p_price, 0, p_price,
      p_created_by, true,
      now(), p_created_by
    )
    RETURNING id INTO v_order_id;

  EXCEPTION
    WHEN unique_violation THEN
      -- IDEMPOTENCIA REAL: el pedido ya existe (retry tras corte de red).
      -- Recuperar el order_id existente y devolverlo como éxito silencioso.
      -- El campo idempotent=true en el retorno permite distinguirlo en logs.
      -- NO se inserta una segunda transacción: la primera ya fue creada y
      -- confirmada (la transacción SQL original fue atómica).
      SELECT id INTO v_order_id
      FROM public.lunch_orders
      WHERE (
        (v_student_id IS NOT NULL AND student_id = v_student_id) OR
        (v_teacher_id IS NOT NULL AND teacher_id = v_teacher_id)
      )
        AND order_date  = p_order_date
        AND category_id = p_category_id
        AND status     != 'cancelled'
      LIMIT 1;

      RETURN jsonb_build_object(
        'lunch_order_id', v_order_id,
        'transaction_id', NULL,
        'payment_status', v_payment_status,
        'idempotent',     true
      );
  END;

  IF p_price > 0 THEN
    INSERT INTO public.transactions (
      student_id, teacher_id, type, amount, description,
      payment_status, payment_method, school_id, created_by,
      is_taxable, billing_status, metadata
    )
    VALUES (
      v_student_id, v_teacher_id, 'purchase', -ABS(p_price), p_description,
      v_payment_status, v_payment_col, p_school_id, p_created_by,
      FALSE, 'excluded',
      jsonb_build_object(
        'lunch_order_id', v_order_id,
        'source', 'delivery_no_order_rpc',
        'order_date', p_order_date::TEXT,
        'category_name', p_category_name,
        'payment_method', p_payment_method,
        'quantity', 1
      )
    )
    RETURNING id INTO v_tx_id;
  END IF;

  RETURN jsonb_build_object(
    'lunch_order_id', v_order_id,
    'transaction_id', v_tx_id,
    'payment_status', v_payment_status,
    'idempotent',     false
  );
END;
$fn$;

COMMENT ON FUNCTION public.create_and_deliver_lunch_order IS
  'RPC atómica cocina: crea lunch_order (delivered) + transaction. '
  'Idempotente: si el pedido ya existe (retry de red), devuelve el order_id '
  'existente silenciosamente (sin error). '
  'lock_timeout=4s, statement_timeout=20s para proteger el pool bajo carga.';

REVOKE ALL    ON FUNCTION public.create_and_deliver_lunch_order FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_and_deliver_lunch_order TO authenticated;


-- ── 2. create_lunch_orders_batch_v2 — lock_timeout + statement_timeout ───────

CREATE OR REPLACE FUNCTION public.create_lunch_orders_batch_v2(
  p_person_type   TEXT,
  p_person_id     UUID,
  p_school_id     UUID,
  p_base_price    NUMERIC,
  p_final_price   NUMERIC,
  p_created_by    UUID,
  p_source        TEXT  DEFAULT 'parent_lunch_calendar',
  p_category_name TEXT  DEFAULT 'Almuerzo',
  p_date_menus    JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_entry      JSONB;
  v_order_date DATE;
  v_cat_id     UUID;
  v_menu_id    UUID;
  v_desc       TEXT;
  v_err_msg    TEXT;
  v_succeeded  JSONB := '[]'::JSONB;
  v_failed     JSONB := '[]'::JSONB;
BEGIN
  -- Timeouts defensivos (ver comentario al inicio de esta migración).
  -- statement_timeout amplio porque el batch puede contener N fechas.
  -- N=8 fechas × ~300ms/fecha → máximo ~2.5s; 30s es el límite de seguridad.
  SET LOCAL lock_timeout      = '4s';
  SET LOCAL statement_timeout = '30s';

  IF p_person_type NOT IN ('student', 'teacher') THEN
    RAISE EXCEPTION 'BATCH_INVALID_TYPE: p_person_type debe ser ''student'' o ''teacher''. Recibido: %', p_person_type;
  END IF;

  IF p_date_menus IS NULL OR jsonb_array_length(p_date_menus) = 0 THEN
    RETURN jsonb_build_object('succeeded', '[]'::JSONB, 'failed', '[]'::JSONB, 'total', 0);
  END IF;

  FOR v_entry IN SELECT jsonb_array_elements(p_date_menus)
  LOOP
    v_order_date := (v_entry->>'order_date')::DATE;
    v_cat_id     := (v_entry->>'category_id')::UUID;
    v_menu_id    := (v_entry->>'menu_id')::UUID;
    v_desc       := COALESCE(
                      v_entry->>'description',
                      p_category_name || ' - ' || TO_CHAR(v_order_date, 'YYYY-MM-DD')
                    );

    BEGIN
      PERFORM public.create_lunch_order_v2(
        p_person_type             := p_person_type,
        p_person_id               := p_person_id,
        p_order_date              := v_order_date,
        p_category_id             := v_cat_id,
        p_menu_id                 := v_menu_id,
        p_school_id               := p_school_id,
        p_quantity                := 1,
        p_base_price              := p_base_price,
        p_final_price             := p_final_price,
        p_created_by              := p_created_by,
        p_source                  := p_source,
        p_category_name           := p_category_name,
        p_description             := v_desc,
        p_selected_modifiers      := NULL,
        p_selected_garnishes      := NULL,
        p_configurable_selections := NULL,
        p_parent_notes            := NULL
      );

      v_succeeded := v_succeeded || jsonb_build_array(v_order_date::TEXT);

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;

      IF v_err_msg LIKE 'LUNCH_DUPLICATE%' THEN
        -- Idempotente: el pedido ya existía (retry de red del padre).
        v_succeeded := v_succeeded || jsonb_build_array(v_order_date::TEXT);
      ELSE
        v_failed := v_failed || jsonb_build_object(
          'date',   v_order_date::TEXT,
          'reason', v_err_msg
        );
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'succeeded', v_succeeded,
    'failed',    v_failed,
    'total',     jsonb_array_length(p_date_menus)
  );
END;
$fn$;

COMMENT ON FUNCTION public.create_lunch_orders_batch_v2 IS
  'Batch de pedidos de padres: ejecuta create_lunch_order_v2 por cada fecha '
  'en un único viaje HTTP. Cada fecha es un SAVEPOINT independiente. '
  'LUNCH_DUPLICATE = éxito idempotente. '
  'lock_timeout=4s, statement_timeout=30s para proteger el pool bajo carga 8AM.';

REVOKE ALL    ON FUNCTION public.create_lunch_orders_batch_v2 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lunch_orders_batch_v2 TO authenticated;

COMMIT;

SELECT
  'create_and_deliver_lunch_order hardened ✅'   AS rpc_cocina,
  'create_lunch_orders_batch_v2 hardened ✅'      AS rpc_batch;
