-- ============================================================================
-- Cobranzas: cerrar payment_status cuando ya hay boleta SUNAT (sent + invoice)
-- Fecha: 2026-05-06
--
-- Problema:
--   Tras emitir comprobante en NubeFact, algunas filas quedan con
--   billing_status='sent', invoice_id NOT NULL, pero payment_status sigue
--   'pending'. process_payment_collection intentaba además bajar
--   billing_status a 'pending' (ticket + transferencia) → doble choque con
--   fn_prevent_modifying_sent_transactions.
--
-- Solución:
--   1) process_payment_collection: si la fila ya está sent con invoice_id,
--      conservar billing_status e is_taxable; solo registrar cobro operativo.
--   2) Trigger: excepción E4 — permitir pending|partial → paid sin tocar
--      monto, invoice_id, ni bajar billing de sent.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_prevent_modifying_sent_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  IF OLD.billing_status <> 'sent' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % ya fue informada a la SUNAT '
      '(invoice_id: %). No se permite el borrado directo. '
      'Para anularla emite una Nota de Crédito desde el módulo de Facturación.',
      OLD.id, OLD.invoice_id
    USING ERRCODE = 'P0001';
  END IF;

  IF OLD.invoice_id IS NULL
     AND NEW.invoice_id IS NOT NULL
     AND OLD.amount              IS NOT DISTINCT FROM NEW.amount
     AND OLD.payment_status      IS NOT DISTINCT FROM NEW.payment_status
     AND OLD.payment_method      IS NOT DISTINCT FROM NEW.payment_method
     AND OLD.student_id          IS NOT DISTINCT FROM NEW.student_id
     AND OLD.teacher_id          IS NOT DISTINCT FROM NEW.teacher_id
     AND OLD.school_id           IS NOT DISTINCT FROM NEW.school_id
     AND OLD.type                IS NOT DISTINCT FROM NEW.type
     AND COALESCE(OLD.is_deleted, false) = COALESCE(NEW.is_deleted, false)
  THEN
    RAISE NOTICE '[SUNAT_INTEGRITY] Transacción % vinculada a invoice_id % (rescate OK).',
      OLD.id, NEW.invoice_id;
    RETURN NEW;
  END IF;

  IF OLD.invoice_id IS NULL
     AND NEW.invoice_id IS NULL
     AND NEW.billing_status IN ('pending', 'processing')
     AND OLD.amount              IS NOT DISTINCT FROM NEW.amount
     AND OLD.payment_status      IS NOT DISTINCT FROM NEW.payment_status
     AND OLD.student_id          IS NOT DISTINCT FROM NEW.student_id
     AND OLD.school_id           IS NOT DISTINCT FROM NEW.school_id
     AND COALESCE(OLD.is_deleted, false) = COALESCE(NEW.is_deleted, false)
  THEN
    RAISE NOTICE '[SUNAT_INTEGRITY] Transacción % (huérfana sin invoice_id) devuelta a "%".',
      OLD.id, NEW.billing_status;
    RETURN NEW;
  END IF;

  IF current_setting('app.void_payment_bypass', true) = 'true' THEN
    IF OLD.amount IS DISTINCT FROM NEW.amount THEN
      RAISE EXCEPTION
        '[SUNAT_INTEGRITY] void_payment: No está permitido cambiar el monto '
        'de una transacción ya informada a SUNAT (tx %, invoice_id: %).',
        OLD.id, OLD.invoice_id
      USING ERRCODE = 'P0001';
    END IF;

    IF OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      RAISE EXCEPTION
        '[SUNAT_INTEGRITY] void_payment: No está permitido cambiar invoice_id '
        'de una transacción ya informada a SUNAT (tx %).',
        OLD.id
      USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(OLD.is_deleted, false) = false
       AND COALESCE(NEW.is_deleted, true) = true
    THEN
      RAISE EXCEPTION
        '[SUNAT_INTEGRITY] void_payment: No se puede marcar como eliminada '
        'una transacción ya informada a SUNAT (tx %).',
        OLD.id
      USING ERRCODE = 'P0001';
    END IF;

    RAISE NOTICE
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %) modificada por void_payment (E3). '
      'payment_status: % → %. La Nota de Crédito SUNAT gestiona la reversión fiscal.',
      OLD.id, OLD.invoice_id, OLD.payment_status, NEW.payment_status;

    RETURN NEW;
  END IF;

  -- E4: comprobante ya emitido y vinculado, pero payment_status quedó pendiente
  --     (fallo de integración u orden de pasos). Cobranzas cierra el cobro sin
  --     re-emitir ni bajar billing de sent.
  IF OLD.invoice_id IS NOT NULL
     AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
     AND NEW.billing_status = 'sent'
     AND OLD.billing_status = 'sent'
     AND OLD.payment_status IN ('pending', 'partial')
     AND NEW.payment_status = 'paid'
     AND OLD.amount IS NOT DISTINCT FROM NEW.amount
     AND OLD.is_taxable IS NOT DISTINCT FROM NEW.is_taxable
     AND OLD.student_id IS NOT DISTINCT FROM NEW.student_id
     AND OLD.teacher_id IS NOT DISTINCT FROM NEW.teacher_id
     AND OLD.school_id IS NOT DISTINCT FROM NEW.school_id
     AND OLD.type IS NOT DISTINCT FROM NEW.type
     AND COALESCE(OLD.is_deleted, false) = COALESCE(NEW.is_deleted, false)
  THEN
    RAISE NOTICE
      '[SUNAT_INTEGRITY] E4: tx % invoice % — payment_status % → paid (cierre operativo, comprobante ya enviado).',
      OLD.id, OLD.invoice_id, OLD.payment_status;
    RETURN NEW;
  END IF;

  IF OLD.amount IS DISTINCT FROM NEW.amount THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se puede cambiar el monto (S/ % → S/ %). '
      'Para corregir un error de importe emite una Nota de Crédito.',
      OLD.id, OLD.invoice_id, OLD.amount, NEW.amount
    USING ERRCODE = 'P0001';
  END IF;

  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se puede cambiar payment_status (% → %) en una transacción ya informada a SUNAT. '
      'Emite una Nota de Crédito.',
      OLD.id, OLD.invoice_id, OLD.payment_status, NEW.payment_status
    USING ERRCODE = 'P0001';
  END IF;

  IF OLD.student_id  IS DISTINCT FROM NEW.student_id  OR
     OLD.teacher_id  IS DISTINCT FROM NEW.teacher_id  OR
     OLD.school_id   IS DISTINCT FROM NEW.school_id   OR
     OLD.type        IS DISTINCT FROM NEW.type
  THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se pueden cambiar los datos del cliente o el tipo de operación '
      'en una transacción ya informada a SUNAT.',
      OLD.id, OLD.invoice_id
    USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(OLD.is_deleted, false) = false
     AND COALESCE(NEW.is_deleted, true) = true
  THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se puede marcar como eliminada una transacción ya informada a SUNAT. '
      'Emite una Nota de Crédito.',
      OLD.id, OLD.invoice_id
    USING ERRCODE = 'P0001';
  END IF;

  IF OLD.invoice_id IS NOT NULL
     AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
  THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se puede cambiar invoice_id una vez vinculado a un comprobante emitido.',
      OLD.id, OLD.invoice_id
    USING ERRCODE = 'P0001';
  END IF;

  IF NEW.billing_status <> 'sent' THEN
    IF OLD.invoice_id IS NOT NULL THEN
      RAISE EXCEPTION
        '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
        'No se puede revertir billing_status de "sent" a "%" cuando '
        'ya existe un invoice_id vinculado. Emite una Nota de Crédito.',
        OLD.id, OLD.invoice_id, NEW.billing_status
      USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        '[SUNAT_INTEGRITY] Transacción % (billing_status=sent, sin invoice_id): '
        'cambio a "%" no permitido. Usa el Panel de Rescate para gestionar '
        'transacciones huérfanas.',
        OLD.id, NEW.billing_status
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;

END;
$$;

COMMENT ON FUNCTION fn_prevent_modifying_sent_transactions IS
  'Trigger BEFORE UPDATE/DELETE: protege transacciones billing_status=sent. '
  'E1=vincular invoice_id, E2=huérfana sin invoice_id, E3=void_payment bypass, '
  'E4=cierre payment pending|partial→paid con invoice y sent intactos.';


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
  v_caller_id          uuid;
  v_is_taxable         boolean;
  v_billing_status     text;
  v_ticket_base        text;
  v_ticket_counter     int := 0;
  v_ticket_code        text;
  v_existing_lo_ids    uuid[];
  v_paid_lo_ids        uuid[];
  lo_rec               record;
  v_lo_amount          numeric;
  v_lo_description     text;
  v_updated_tx_count   int     := 0;
  v_created_tx_count   int     := 0;
  v_actual_kiosk_amount numeric := 0;
  v_dup_op_count       int     := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado';
  END IF;

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
      FROM   lunch_orders lo
      WHERE  lo.id = ANY(p_lunch_order_ids)
        AND  (lo.is_cancelled = true OR lo.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'CONFLICT: Uno o más pedidos de almuerzo están anulados. Recarga la lista e intenta de nuevo.';
    END IF;

    SELECT ARRAY_AGG(DISTINCT (t.metadata->>'lunch_order_id')::uuid)
    INTO   v_paid_lo_ids
    FROM   transactions t
    WHERE  t.type = 'purchase'
      AND  t.is_deleted = false
      AND  t.payment_status = 'paid'
      AND  (t.metadata->>'lunch_order_id') IS NOT NULL
      AND  (t.metadata->>'lunch_order_id')::uuid = ANY(p_lunch_order_ids);

    IF COALESCE(cardinality(v_paid_lo_ids), 0) > 0 THEN
      RAISE EXCEPTION 'CONFLICT: Uno o más pedidos de almuerzo ya tienen pago registrado. Recarga la lista e intenta de nuevo.';
    END IF;
  END IF;

  IF p_operation_number IS NOT NULL
  AND trim(p_operation_number) <> ''
  AND p_student_id IS NOT NULL
  THEN
    SELECT COUNT(*)
    INTO   v_dup_op_count
    FROM   transactions t
    WHERE  t.student_id       = p_student_id
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

  SELECT COALESCE(SUM(ABS(t.amount)), 0)
  INTO   v_actual_kiosk_amount
  FROM   transactions t
  WHERE  t.id = ANY(p_real_tx_ids)
    AND  t.metadata->>'lunch_order_id' IS NULL
    AND  t.payment_status IN ('pending', 'partial');

  IF array_length(p_real_tx_ids, 1) > 0 THEN
    UPDATE transactions AS t
    SET
      payment_status   = 'paid',
      payment_method   = p_payment_method,
      operation_number = p_operation_number,
      created_by       = v_caller_id,
      is_taxable       = CASE
        WHEN t.billing_status = 'sent' AND t.invoice_id IS NOT NULL
          THEN t.is_taxable
        ELSE v_is_taxable
      END,
      billing_status   = CASE
        WHEN t.billing_status = 'sent' AND t.invoice_id IS NOT NULL
          THEN t.billing_status
        ELSE v_billing_status
      END
    WHERE t.id = ANY(p_real_tx_ids)
      AND t.payment_status IN ('pending', 'partial');

    GET DIAGNOSTICS v_updated_tx_count = ROW_COUNT;
  END IF;

  BEGIN
    SELECT get_next_ticket_number(v_caller_id) INTO v_ticket_base;
  EXCEPTION WHEN OTHERS THEN
    v_ticket_base := 'COB-' || to_char(now(), 'YYYYMMDD-HH24MISS');
  END;

  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT (t.metadata->>'lunch_order_id')::uuid)
    INTO   v_existing_lo_ids
    FROM   transactions t
    WHERE  t.type       = 'purchase'
      AND  t.is_deleted = false
      AND  t.payment_status IN ('pending', 'partial', 'paid')
      AND  (t.metadata->>'lunch_order_id')::uuid = ANY(p_lunch_order_ids);
  END IF;

  IF array_length(p_lunch_order_ids, 1) > 0 THEN
    FOR lo_rec IN
      SELECT
        lo.id                                                           AS lunch_order_id,
        lo.order_date                                                   AS order_date,
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
        jsonb_build_object('lunch_order_id', lo_rec.lunch_order_id::text, 'source_channel', 'admin_cxc')
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

  UPDATE lunch_orders
  SET
    status       = CASE
                     WHEN order_date <= CURRENT_DATE THEN 'delivered'
                     ELSE 'confirmed'
                   END,
    delivered_at = CASE
                     WHEN order_date <= CURRENT_DATE THEN now()
                     ELSE NULL
                   END
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

  IF p_student_id IS NOT NULL AND v_actual_kiosk_amount > 0 THEN
    BEGIN
      PERFORM adjust_student_balance(p_student_id, v_actual_kiosk_amount);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'BALANCE_UPDATE_FAILED: No se pudo ajustar balance del alumno %: %',
        p_student_id, SQLERRM;
    END;
  END IF;

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
  'RPC atómico de cobro masivo. v5.1 (2026-05-06): conserva billing_status=sent '
  'e is_taxable cuando ya hay invoice_id (cierre operativo sin re-emitir). '
  'v5 (2026-04-24): Cobranzas vs lunch_orders anulados; anti-doble-cobro lunch; source_channel=admin_cxc.';
