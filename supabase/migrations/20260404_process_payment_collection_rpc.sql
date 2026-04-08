-- ============================================================
-- RPC ATÓMICO: process_payment_collection
-- ============================================================
-- Reemplaza la cadena de 4+ llamadas client-side en
-- handleRegisterPayment por UNA sola transacción de BD.
--
-- Si cualquier paso falla, Postgres hace ROLLBACK de todo.
-- Ningún pago queda a medias.
--
-- Parámetros:
--   p_real_tx_ids      → UUIDs de transacciones ya existentes (cafetería)
--   p_lunch_order_ids  → UUIDs de pedidos de almuerzo virtuales (aún sin transacción)
--   p_payment_method   → efectivo | yape | plin | transferencia | tarjeta | mixto
--   p_operation_number → número de operación bancaria (puede ser NULL para efectivo)
--   p_document_type    → ticket | boleta | factura
--   p_school_id        → UUID de la sede
--   p_amount_paid      → monto total cobrado
--   p_student_id       → UUID del alumno (para ajuste de balance, puede ser NULL)
--   p_payment_breakdown→ JSONB con detalle de pago dividido/mixto (puede ser NULL)
--
-- Retorna: JSONB con { success, ticket_base, created_tx_count, updated_tx_count }
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

  -- Billing flags (replica de calcBillingFlags de billingUtils.ts)
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
  -- E4: monto real calculado desde la BD (no confiar en p_amount_paid)
  v_actual_kiosk_amount numeric := 0;
BEGIN
  -- ── AUTENTICACIÓN ────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

  -- ── CALCULAR BILLING FLAGS (igual a billingUtils.ts) ─────────────────────
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

  -- ── E1 FIX: BLOQUEO PESIMISTA (SELECT FOR UPDATE) ────────────────────────
  -- Adquirir lock exclusivo sobre las filas ANTES de leer su estado.
  -- Bajo Read Committed, sin FOR UPDATE dos transacciones concurrentes pueden
  -- leer ambas 'pending' y pasar el check — este lock fuerza serialización:
  -- la segunda transacción espera, y cuando le toca ya ve las filas como 'paid'.
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

  -- ── PASO 0: VALIDAR que las transacciones reales sigan pendientes ─────────
  -- Ahora que tenemos el lock, leemos el estado ACTUAL (post-commit de otros).
  -- Si alguna fue cobrada por otra sesión mientras esperábamos → ROLLBACK total.
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

  -- Validar también que los lunch_orders no estén ya entregados/cancelados
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

  -- ── E4 FIX: CALCULAR MONTO REAL DESDE LA BD ──────────────────────────────
  -- NO confiamos en p_amount_paid para el ajuste de balance del kiosco.
  -- Sumamos los montos reales de las transacciones de cafetería (sin lunch_order_id).
  -- p_amount_paid solo se usa para el audit log (referencia declarada del cajero).
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
  INTO   v_actual_kiosk_amount
  FROM   transactions t
  WHERE  t.id = ANY(p_real_tx_ids)
    AND  t.metadata->>'lunch_order_id' IS NULL   -- solo deuda de cafetería
    AND  t.payment_status IN ('pending', 'partial');

  -- ── PASO 1: ACTUALIZAR transacciones reales existentes ───────────────────
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
      AND payment_status IN ('pending', 'partial');   -- doble candado

    GET DIAGNOSTICS v_updated_tx_count = ROW_COUNT;
  END IF;

  -- ── PASO 2: GENERAR BASE DE TICKET ───────────────────────────────────────
  BEGIN
    SELECT get_next_ticket_number(v_caller_id) INTO v_ticket_base;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback seguro si el RPC de tickets no existe
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

  -- ── PASO 4: CREAR transacciones para pedidos de almuerzo virtuales ────────
  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    FOR lo_rec IN
      SELECT
        lo.id                                                           AS lunch_order_id,
        lo.student_id,
        lo.teacher_id,
        COALESCE(lo.school_id, st.school_id, tp.school_id_1)           AS school_id,
        lo.manual_name                                                  AS manual_client_name,
        -- Mismo cálculo de precio que en get_billing_consolidated_debtors
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
        -- Misma descripción que en get_billing_consolidated_debtors
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
        -- Saltar los que ya tienen transacción (anti-duplicado)
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
        -- metadata: lunch_order_id + breakdown opcional
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

  -- ── PASO 5: MARCAR lunch_orders como 'delivered' ──────────────────────────
  -- Incluye: (a) los virtuales del paso anterior
  --          (b) los reales que también tenían lunch_order_id en metadata
  UPDATE lunch_orders
  SET
    status       = 'delivered',
    delivered_at = now()
  WHERE id = ANY(
    -- Virtuales: los que recibimos como parámetro
    p_lunch_order_ids
    ||
    -- Reales: extraer lunch_order_id del metadata de las transacciones reales
    ARRAY(
      SELECT DISTINCT (t.metadata->>'lunch_order_id')::uuid
      FROM   transactions t
      WHERE  t.id = ANY(p_real_tx_ids)
        AND  t.metadata->>'lunch_order_id' IS NOT NULL
    )
  )
  AND status NOT IN ('delivered', 'cancelled');

  -- ── PASO 6: AJUSTAR BALANCE DEL ALUMNO ───────────────────────────────────
  -- E4 FIX: Usamos v_actual_kiosk_amount (calculado desde BD), NO p_amount_paid.
  -- Razón: p_amount_paid viene del cliente y puede ser manipulado.
  -- Solo aplica a deuda de cafetería (lunch_order_id IS NULL).
  -- Regla de Oro #1: almuerzos no tocan students.balance.
  IF p_student_id IS NOT NULL AND v_actual_kiosk_amount > 0 THEN
    BEGIN
      PERFORM adjust_student_balance(p_student_id, v_actual_kiosk_amount);
    EXCEPTION WHEN OTHERS THEN
      -- No bloquear el cobro si el balance falla — registrar la advertencia
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
    -- No revertir todo el cobro si solo falla el log
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
  -- Re-lanzar para que Postgres haga ROLLBACK de todo lo anterior
  RAISE;
END;
$$;

-- ── PERMISOS ────────────────────────────────────────────────────────────────
-- La función es SECURITY DEFINER (corre como el owner).
-- Solo usuarios autenticados pueden llamarla.
GRANT EXECUTE ON FUNCTION process_payment_collection(
  uuid[], uuid[], text, text, text, uuid, numeric, uuid, jsonb
) TO authenticated;

-- ── COMENTARIO ───────────────────────────────────────────────────────────────
COMMENT ON FUNCTION process_payment_collection IS
  'RPC atómico de cobro masivo. Reemplaza la cadena de 4+ llamadas client-side '
  'de handleRegisterPayment. Si cualquier paso falla, Postgres revierte todo. '
  'Incluye: update real txs, anti-dup check, insert virtual txs, mark delivered, '
  'adjust balance, audit log.';
