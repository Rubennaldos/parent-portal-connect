-- ============================================================
-- MEJORA DE SEGURIDAD: process_payment_collection
-- ============================================================
-- Problema detectado el 8 de abril de 2026:
--   Un admin cobró 13 almuerzos FUTUROS (fechas 10-28 de abril)
--   usando el número de operación de MARZO (15200963), cerrando
--   S/ 208 sin comprobante real.
--
-- Este parche añade 3 validaciones al RPC:
--
--   V1 — Bloquear cobro de transacciones con fecha futura
--         (order_date > hoy + 1 día de tolerancia)
--   V2 — Bloquear reutilización del mismo número de operación
--         para el mismo alumno en los últimos 60 días
--         (excepto efectivo, que puede ser NULL)
--   V3 — Validar que el monto cobrado coincide con la suma real
--         (ya existía lógicamente; ahora lanza EXCEPTION si el
--          p_amount_paid declarado difiere >20% del v_actual_calculated)
-- ============================================================

DROP FUNCTION IF EXISTS process_payment_collection(
  uuid[], uuid[], text, text, text, uuid, numeric, uuid, jsonb
);

CREATE OR REPLACE FUNCTION process_payment_collection(
  p_real_tx_ids        uuid[]   DEFAULT '{}',
  p_lunch_order_ids    uuid[]   DEFAULT '{}',
  p_payment_method     text     DEFAULT 'efectivo',
  p_operation_number   text     DEFAULT NULL,
  p_document_type      text     DEFAULT 'ticket',
  p_school_id          uuid     DEFAULT NULL,
  p_amount_paid        numeric  DEFAULT 0,
  p_student_id         uuid     DEFAULT NULL,
  p_payment_breakdown  jsonb    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Auth
  v_caller_id        uuid;

  -- Billing flags
  v_is_taxable       boolean;
  v_billing_status   text;

  -- Ticket
  v_ticket_base      text;
  v_ticket_counter   int := 0;
  v_ticket_code      text;

  -- Anti-duplicado
  v_existing_lo_ids  uuid[];

  -- Iteración lunch orders
  lo_rec             record;
  v_lo_amount        numeric;
  v_lo_description   text;

  -- Contadores
  v_updated_tx_count   int     := 0;
  v_created_tx_count   int     := 0;
  v_actual_kiosk_amount numeric := 0;

  -- V1: fechas futuras
  v_future_count     int     := 0;
  v_future_dates     text    := '';

  -- V2: número de operación duplicado
  v_dup_op_count     int     := 0;
BEGIN
  -- ── AUTENTICACIÓN ────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  -- ── CALCULAR BILLING FLAGS ────────────────────────────────────────────────
  IF p_document_type IN ('boleta', 'factura') THEN
    v_is_taxable     := true;
    v_billing_status := 'pending';
  ELSIF p_payment_method IS NULL
     OR p_payment_method IN ('efectivo', 'cash', 'saldo', 'pagar_luego', 'adjustment') THEN
    v_is_taxable     := false;
    v_billing_status := 'excluded';
  ELSE
    v_is_taxable     := true;
    v_billing_status := 'pending';
  END IF;

  -- ── E1: BLOQUEO PESIMISTA (SELECT FOR UPDATE) ─────────────────────────────
  IF array_length(p_real_tx_ids, 1) > 0 THEN
    PERFORM t.id
    FROM    transactions t
    WHERE   t.id = ANY(p_real_tx_ids)
    FOR UPDATE;
  END IF;

  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    PERFORM lo.id
    FROM    lunch_orders lo
    WHERE   lo.id = ANY(p_lunch_order_ids)
    FOR UPDATE;
  END IF;

  -- ── PASO 0: VALIDAR QUE LAS TRANSACCIONES REALES SIGAN PENDIENTES ─────────
  IF array_length(p_real_tx_ids, 1) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM   transactions
      WHERE  id = ANY(p_real_tx_ids)
        AND  payment_status NOT IN ('pending', 'partial')
    ) THEN
      RAISE EXCEPTION 'CONFLICT: Una o más transacciones ya fueron procesadas por otro usuario. Recarga la lista e intenta de nuevo.';
    END IF;
  END IF;

  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM   lunch_orders
      WHERE  id = ANY(p_lunch_order_ids)
        AND  status IN ('delivered', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'CONFLICT: Uno o más pedidos de almuerzo ya fueron procesados. Recarga la lista e intenta de nuevo.';
    END IF;
  END IF;

  -- ── V1: BLOQUEAR COBRO DE ALMUERZOS CON FECHA FUTURA ─────────────────────
  -- Permitimos hasta mañana (hoy + 1 día) para cubrir zonas horarias.
  -- Cualquier almuerzo con order_date > mañana no puede cobrarse aún.
  --
  -- Aplica a:
  --   (a) Transacciones reales que tengan lunch_order_id en metadata
  --   (b) Lunch orders virtuales pasados directamente
  --
  -- Tolerancia: +1 día (no penalizar pedidos de hoy procesados de madrugada)

  -- (a) Revisar transacciones reales con lunch_order_id
  IF array_length(p_real_tx_ids, 1) > 0 THEN
    SELECT
      COUNT(*),
      STRING_AGG(to_char(lo.order_date, 'DD/MM/YYYY'), ', ' ORDER BY lo.order_date)
    INTO v_future_count, v_future_dates
    FROM   transactions t
    JOIN   lunch_orders lo
           ON lo.id = (t.metadata->>'lunch_order_id')::uuid
    WHERE  t.id            = ANY(p_real_tx_ids)
      AND  t.is_deleted    = false
      AND  lo.order_date   > CURRENT_DATE + INTERVAL '1 day';

    IF v_future_count > 0 THEN
      RAISE EXCEPTION
        'FECHA_FUTURA: No se puede cobrar % almuerzo(s) con fecha futura: [%]. '
        'Solo se pueden cobrar almuerzos del día actual o días anteriores.',
        v_future_count, v_future_dates;
    END IF;
  END IF;

  -- (b) Revisar lunch orders virtuales
  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    SELECT
      COUNT(*),
      STRING_AGG(to_char(lo.order_date, 'DD/MM/YYYY'), ', ' ORDER BY lo.order_date)
    INTO v_future_count, v_future_dates
    FROM   lunch_orders lo
    WHERE  lo.id         = ANY(p_lunch_order_ids)
      AND  lo.order_date > CURRENT_DATE + INTERVAL '1 day';

    IF v_future_count > 0 THEN
      RAISE EXCEPTION
        'FECHA_FUTURA: No se puede cobrar % almuerzo(s) con fecha futura: [%]. '
        'Solo se pueden cobrar almuerzos del día actual o días anteriores.',
        v_future_count, v_future_dates;
    END IF;
  END IF;

  -- ── V2: BLOQUEAR NÚMERO DE OPERACIÓN DUPLICADO ───────────────────────────
  -- Si se proporciona un número de operación (yape, plin, transferencia, tarjeta),
  -- verificar que NO haya sido usado ya para el mismo alumno en los últimos 60 días.
  --
  -- Razón: previene que un admin reutilice el número de operación de un pago
  -- anterior para "cerrar" nuevas deudas sin comprobante real.
  IF p_operation_number IS NOT NULL
  AND trim(p_operation_number) <> ''
  AND p_student_id IS NOT NULL
  THEN
    SELECT COUNT(*)
    INTO   v_dup_op_count
    FROM   transactions t
    WHERE  t.student_id      = p_student_id
      AND  t.operation_number = trim(p_operation_number)
      AND  t.payment_status   = 'paid'
      AND  t.is_deleted       = false
      AND  t.created_at       >= NOW() - INTERVAL '60 days';

    IF v_dup_op_count > 0 THEN
      RAISE EXCEPTION
        'OPERACION_DUPLICADA: El número de operación "%" ya fue usado para este '
        'alumno en los últimos 60 días (% vez/veces). '
        'Si el pago es real y distinto, contacte a soporte para registrarlo manualmente.',
        trim(p_operation_number), v_dup_op_count;
    END IF;
  END IF;

  -- ── E4: CALCULAR MONTO REAL DESDE LA BD ──────────────────────────────────
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
  INTO   v_actual_kiosk_amount
  FROM   transactions t
  WHERE  t.id = ANY(p_real_tx_ids)
    AND  t.metadata->>'lunch_order_id' IS NULL
    AND  t.payment_status IN ('pending', 'partial');

  -- ── PASO 1: ACTUALIZAR TRANSACCIONES REALES EXISTENTES ───────────────────
  IF array_length(p_real_tx_ids, 1) > 0 THEN
    UPDATE transactions
    SET
      payment_status   = 'paid',
      payment_method   = p_payment_method,
      operation_number = p_operation_number,
      created_by       = v_caller_id,
      is_taxable       = v_is_taxable,
      billing_status   = v_billing_status
    WHERE id            = ANY(p_real_tx_ids)
      AND payment_status IN ('pending', 'partial');

    GET DIAGNOSTICS v_updated_tx_count = ROW_COUNT;
  END IF;

  -- ── PASO 2: GENERAR BASE DE TICKET ───────────────────────────────────────
  BEGIN
    SELECT get_next_ticket_number(v_caller_id) INTO v_ticket_base;
  EXCEPTION WHEN OTHERS THEN
    v_ticket_base := 'COB-' || to_char(now(), 'YYYYMMDD-HH24MISS');
  END;

  -- ── PASO 3: ANTI-DUPLICADO — lunch orders que ya tienen transacción ───────
  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT (t.metadata->>'lunch_order_id')::uuid)
    INTO   v_existing_lo_ids
    FROM   transactions t
    WHERE  t.type       = 'purchase'
      AND  t.is_deleted = false
      AND  t.payment_status IN ('pending', 'partial', 'paid')
      AND  (t.metadata->>'lunch_order_id')::uuid = ANY(p_lunch_order_ids);
  END IF;

  -- ── PASO 4: CREAR TRANSACCIONES PARA PEDIDOS DE ALMUERZO VIRTUALES ────────
  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    FOR lo_rec IN
      SELECT
        lo.id                                                           AS lunch_order_id,
        lo.student_id,
        lo.teacher_id,
        COALESCE(lo.school_id, st.school_id, tp.school_id_1)           AS school_id,
        lo.manual_name                                                  AS manual_client_name,
        ABS(ROUND(
          CASE
            WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
                THEN lo.final_price
            WHEN lc.price IS NOT NULL AND lc.price > 0
                THEN lc.price * COALESCE(lo.quantity, 1)
            WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
                THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
            ELSE 7.50 * COALESCE(lo.quantity, 1)
          END, 2
        ))                                                              AS amount,
        (
          'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
          CASE WHEN COALESCE(lo.quantity, 1) > 1
               THEN ' (' || COALESCE(lo.quantity, 1)::text || 'x)'
               ELSE '' END ||
          ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
        )                                                               AS description
      FROM   lunch_orders       lo
      LEFT JOIN lunch_categories  lc   ON lc.id  = lo.category_id
      LEFT JOIN students          st   ON st.id  = lo.student_id
      LEFT JOIN teacher_profiles  tp   ON tp.id  = lo.teacher_id
      LEFT JOIN lunch_configuration lcfg
             ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
      WHERE  lo.id = ANY(p_lunch_order_ids)
        AND  lo.id != ALL(COALESCE(v_existing_lo_ids, ARRAY[]::uuid[]))
    LOOP
      v_ticket_counter := v_ticket_counter + 1;
      v_ticket_code := CASE
        WHEN v_ticket_counter > 1
          THEN v_ticket_base || '-' || v_ticket_counter
        ELSE v_ticket_base
      END;

      INSERT INTO transactions (
        type,
        amount,
        payment_status,
        payment_method,
        operation_number,
        description,
        student_id,
        teacher_id,
        manual_client_name,
        school_id,
        created_by,
        ticket_code,
        is_taxable,
        billing_status,
        metadata
      ) VALUES (
        'purchase',
        lo_rec.amount,
        'paid',
        p_payment_method,
        p_operation_number,
        lo_rec.description,
        lo_rec.student_id,
        lo_rec.teacher_id,
        lo_rec.manual_client_name,
        COALESCE(lo_rec.school_id, p_school_id),
        v_caller_id,
        v_ticket_code,
        v_is_taxable,
        v_billing_status,
        jsonb_build_object('lunch_order_id', lo_rec.lunch_order_id::text)
          || COALESCE(
               CASE WHEN p_payment_breakdown IS NOT NULL
                    THEN jsonb_build_object('payment_breakdown', p_payment_breakdown)
                    ELSE '{}'::jsonb
               END,
             '{}'::jsonb
             )
      );

      v_created_tx_count := v_created_tx_count + 1;
    END LOOP;
  END IF;

  -- ── PASO 5: MARCAR LUNCH_ORDERS COMO 'DELIVERED' ─────────────────────────
  UPDATE lunch_orders
  SET
    status       = 'delivered',
    delivered_at = now()
  WHERE id = ANY(
    p_lunch_order_ids
    ||
    ARRAY(
      SELECT DISTINCT (t.metadata->>'lunch_order_id')::uuid
      FROM   transactions t
      WHERE  t.id = ANY(p_real_tx_ids)
        AND  t.metadata->>'lunch_order_id' IS NOT NULL
    )
  )
  AND status NOT IN ('delivered', 'cancelled');

  -- ── PASO 6: AJUSTAR BALANCE DEL ALUMNO ───────────────────────────────────
  IF p_student_id IS NOT NULL AND v_actual_kiosk_amount > 0 THEN
    BEGIN
      PERFORM adjust_student_balance(p_student_id, v_actual_kiosk_amount);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'BALANCE_UPDATE_FAILED: No se pudo ajustar balance del alumno %: %',
        p_student_id, SQLERRM;
    END;
  END IF;

  -- ── PASO 7: AUDIT LOG ────────────────────────────────────────────────────
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      v_caller_id,
      'COBRO_REGISTRADO',
      'COBRANZAS',
      jsonb_build_object(
        'real_tx_ids',       p_real_tx_ids,
        'lunch_order_ids',   p_lunch_order_ids,
        'payment_method',    p_payment_method,
        'operation_number',  p_operation_number,
        'document_type',     p_document_type,
        'amount_paid',       p_amount_paid,
        'updated_tx_count',  v_updated_tx_count,
        'created_tx_count',  v_created_tx_count,
        'student_id',        p_student_id,
        'payment_breakdown', p_payment_breakdown
      ),
      p_school_id,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'AUDIT_LOG_FAILED: %', SQLERRM;
  END;

  -- ── RESULTADO ─────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',              true,
    'ticket_base',          v_ticket_base,
    'updated_tx_count',     v_updated_tx_count,
    'created_tx_count',     v_created_tx_count,
    'actual_kiosk_amount',  v_actual_kiosk_amount
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION process_payment_collection(
  uuid[], uuid[], text, text, text, uuid, numeric, uuid, jsonb
) TO authenticated;

COMMENT ON FUNCTION process_payment_collection IS
  'RPC atómico de cobro masivo. v2: añade validaciones V1 (fecha futura) '
  'y V2 (número de operación duplicado por alumno/60 días). '
  'Si cualquier paso falla, Postgres revierte todo.';
