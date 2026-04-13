-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Fix SUNAT-Guard vs void_payment
-- Fecha: 2026-04-13
--
-- PROBLEMA:
--   void_payment intenta cambiar payment_status en transacciones con
--   billing_status='sent' + invoice_id IS NOT NULL.
--   El trigger fn_prevent_modifying_sent_transactions bloquea esto
--   correctamente para operaciones aleatorias, pero también bloquea
--   anulaciones legítimas que ya incluyen la Nota de Crédito SUNAT (código 07).
--
-- SOLUCIÓN:
--   1. Añadir Excepción E3 al trigger: si el parámetro de sesión
--      app.void_payment_bypass = 'true' está activo (LOCAL a la transacción),
--      se permite el cambio. El flag solo puede ser activado desde dentro de
--      una función SECURITY DEFINER controlada.
--
--   2. Actualizar void_payment para:
--      a) Activar el flag antes de los UPDATEs problemáticos.
--      b) Para CASO B: NO borrar billing_status ('sent' se mantiene para
--         preservar el rastro SUNAT; la NC ya refleja la anulación fiscal).
--         Solo se cambia payment_status a 'pending' y se añade metadata de void.
--
-- INTEGRIDAD FISCAL:
--   - La fila original (con invoice_id) PERMANECE con billing_status='sent'.
--   - El invoice_id NO cambia.
--   - El monto NO cambia.
--   - La Nota de Crédito (emitida en PASO 4 de void_payment) es el documento
--     SUNAT que refleja la anulación. Eso es lo correcto fiscalmente.
--   - Para el sistema operativo, payment_status='pending' hace que la deuda
--     reaparezca en view_student_debts para que el padre vuelva a pagarla.
-- ══════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1: Actualizar trigger con Excepción E3 (bypass autorizado)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_prevent_modifying_sent_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── Guardia de entrada: solo aplica cuando la fila YA era 'sent' ──────────
  IF OLD.billing_status <> 'sent' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOQUEO ABSOLUTO: DELETE
  -- ══════════════════════════════════════════════════════════════════════════
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % ya fue informada a la SUNAT '
      '(invoice_id: %). No se permite el borrado directo. '
      'Para anularla emite una Nota de Crédito desde el módulo de Facturación.',
      OLD.id, OLD.invoice_id
    USING ERRCODE = 'P0001';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- EXCEPCIONES PERMITIDAS (UPDATE)
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── EXCEPCIÓN 1: Vincular invoice_id (rescate de zombie confirmado) ───────
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

  -- ── EXCEPCIÓN 2: Devolver huérfana a pending (nunca llegó a SUNAT) ────────
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

  -- ── EXCEPCIÓN 3: Anulación autorizada desde void_payment ─────────────────
  -- void_payment activa este flag LOCAL a la transacción antes de los UPDATEs.
  -- El flag es LOCAL: se resetea automáticamente al terminar la transacción.
  -- Garantías adicionales:
  --   • Solo void_payment activa el flag (función SECURITY DEFINER controlada).
  --   • void_payment ya validó: status='approved', no split-payment, etc.
  --   • El invoice_id NO puede cambiar (chequeo abajo en E3).
  --   • El amount NO puede cambiar (chequeo abajo en E3).
  --   • billing_status NO puede cambiar (void_payment no lo toca en CASO B).
  IF current_setting('app.void_payment_bypass', true) = 'true' THEN
    -- Aunque el bypass esté activo, garantizamos que invoice_id y amount
    -- son intocables — son los datos que SUNAT ya registró.
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

    -- Campos seguros — registrar en log y permitir (solo metadata, payment_status, etc.)
    RAISE NOTICE
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %) modificada por void_payment (E3). '
      'payment_status: % → %. La Nota de Crédito SUNAT gestiona la reversión fiscal.',
      OLD.id, OLD.invoice_id, OLD.payment_status, NEW.payment_status;

    RETURN NEW;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOQUEO GENERAL: campos financieros críticos
  -- ══════════════════════════════════════════════════════════════════════════

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

  -- ── Campos no críticos (notes, metadata, ticket_code, etc.): PERMITIDO ────
  RETURN NEW;

END;
$$;

COMMENT ON FUNCTION fn_prevent_modifying_sent_transactions IS
  'Trigger BEFORE UPDATE/DELETE que protege la integridad contable de '
  'transacciones ya informadas a SUNAT (billing_status=sent). '
  'Excepciones: E1=vincular invoice_id, E2=rescate huérfana sin invoice_id, '
  'E3=anulación autorizada desde void_payment (app.void_payment_bypass=true). '
  'E3 protege: amount e invoice_id no cambian nunca; solo payment_status+metadata.';


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2: Reemplazar void_payment con bypass + billing_status corregido
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS void_payment(uuid, uuid, text);

CREATE OR REPLACE FUNCTION void_payment(
  p_request_id uuid,
  p_admin_id   uuid,
  p_reason     text DEFAULT 'Anulación solicitada por administrador'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req               record;
  v_tx_ids            uuid[];
  v_lunch_ids         uuid[];
  v_kiosk_sum         numeric := 0;
  v_current_balance   numeric;
  v_balance_deducted  numeric := 0;
  v_credit_note_id    uuid;
  v_orig_invoice      record;
  v_serie_nc          text;
  v_reverted_tx_count int    := 0;
  v_reverted_lo_count int    := 0;
BEGIN

  -- ── PASO 1: BLOQUEO OPTIMISTA ─────────────────────────────────────────────
  SELECT * INTO v_req
  FROM   recharge_requests
  WHERE  id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: La solicitud % no existe.', p_request_id;
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'INVALID_STATE: Solo se pueden anular pagos aprobados. Estado actual: %.', v_req.status;
  END IF;

  IF COALESCE(v_req.wallet_amount, 0) > 0 THEN
    RAISE EXCEPTION
      'SPLIT_PAYMENT: Los pagos con billetera interna (wallet_amount=S/ %) '
      'requieren reversión manual. Contacta soporte técnico.',
      v_req.wallet_amount;
  END IF;

  -- ── PASO 2: MARCAR SOLICITUD COMO ANULADA ────────────────────────────────
  UPDATE recharge_requests
  SET    status      = 'voided',
         voided_by   = p_admin_id,
         voided_at   = NOW(),
         void_reason = p_reason
  WHERE  id = p_request_id;

  -- ── ACTIVAR BYPASS SUNAT-GUARD ────────────────────────────────────────────
  -- LOCAL=true: el flag es válido SOLO dentro de esta transacción de BD.
  -- Se resetea automáticamente cuando la transacción termina (commit/rollback).
  -- Permite que el trigger fn_prevent_modifying_sent_transactions acepte
  -- los cambios de payment_status en transacciones ya informadas a SUNAT,
  -- siempre que amount e invoice_id no cambien (garantizado por E3 del trigger).
  PERFORM set_config('app.void_payment_bypass', 'true', true);

  -- ── PASO 3: LÓGICA DE REVERSIÓN POR TIPO ─────────────────────────────────

  IF COALESCE(v_req.request_type, 'recharge') = 'recharge' THEN

    -- ─── CASO A: RECARGA DE SALDO ───────────────────────────────────────────
    -- Las transacciones de recarga tienen billing_status='excluded' →
    -- el trigger NO se activa para ellas. El bypass es precaución adicional.
    UPDATE transactions
    SET    payment_status = 'cancelled',
           metadata       = COALESCE(metadata, '{}') || jsonb_build_object(
             'voided',          true,
             'voided_by',       p_admin_id::text,
             'voided_at',       to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'void_reason',     p_reason,
             'void_request_id', p_request_id::text
           )
    WHERE  metadata->>'recharge_request_id' = p_request_id::text
      AND  type           = 'recharge'
      AND  payment_status = 'paid'
      AND  is_deleted     = false;

    PERFORM adjust_student_balance(v_req.student_id, -(v_req.amount));
    v_balance_deducted := v_req.amount;

  ELSE

    -- ─── CASO B: PAGO DE DEUDA / PAGO DE ALMUERZO ──────────────────────────
    -- Puede incluir transacciones con billing_status='sent' + invoice_id.
    -- El bypass E3 permite el cambio; la Nota de Crédito (PASO 4) es la
    -- reversión fiscal correcta ante SUNAT.
    --
    -- IMPORTANTE: NO se toca billing_status ni is_taxable porque la transacción
    -- original ya está en SUNAT. Solo cambia payment_status (para que la deuda
    -- reaparezca) y metadata (para auditoría).

    SELECT array_agg(id) INTO v_tx_ids
    FROM   transactions
    WHERE  metadata->>'recharge_request_id' = p_request_id::text
      AND  payment_status = 'paid'
      AND  is_deleted     = false;

    v_lunch_ids := COALESCE(v_req.lunch_order_ids, '{}');

    IF COALESCE(cardinality(v_tx_ids), 0) > 0 THEN
      UPDATE transactions t
      SET    payment_status = 'pending',
             payment_method = NULL,
             -- billing_status e is_taxable se mantienen intactos:
             -- la transacción original sigue referenciada en SUNAT.
             -- La Nota de Crédito (PASO 4) es el documento corrector.
             metadata       = COALESCE(t.metadata, '{}') || jsonb_build_object(
               'voided',          true,
               'voided_by',       p_admin_id::text,
               'voided_at',       to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'void_reason',     p_reason,
               'void_request_id', p_request_id::text
             )
      WHERE  t.id           = ANY(v_tx_ids)
        AND  t.payment_status = 'paid'
        AND  t.is_deleted     = false;

      GET DIAGNOSTICS v_reverted_tx_count = ROW_COUNT;
    END IF;

    -- Revertir lunch_orders: 'confirmed' → 'pending'
    IF COALESCE(cardinality(v_lunch_ids), 0) > 0 THEN
      UPDATE lunch_orders
      SET    status = 'pending'
      WHERE  id           = ANY(v_lunch_ids)
        AND  is_cancelled = false
        AND  status       = 'confirmed';

      GET DIAGNOSTICS v_reverted_lo_count = ROW_COUNT;
    END IF;

    -- Revertir ajuste de balance para transacciones de kiosco
    IF COALESCE(cardinality(v_tx_ids), 0) > 0 THEN
      SELECT COALESCE(SUM(ABS(t.amount)), 0)
      INTO   v_kiosk_sum
      FROM   transactions t
      WHERE  t.id                                  = ANY(v_tx_ids)
        AND  (t.metadata->>'lunch_order_id') IS NULL;

      IF v_kiosk_sum > 0.01 THEN
        SELECT COALESCE(balance, 0) INTO v_current_balance
        FROM   students
        WHERE  id = v_req.student_id;

        v_balance_deducted := LEAST(v_kiosk_sum, GREATEST(0, v_current_balance));

        IF v_balance_deducted > 0.01 THEN
          PERFORM adjust_student_balance(v_req.student_id, -v_balance_deducted);
        END IF;
      END IF;
    END IF;

  END IF;

  -- ── DESACTIVAR BYPASS ─────────────────────────────────────────────────────
  -- No estrictamente necesario (LOCAL se resetea al terminar la transacción),
  -- pero lo hacemos explícito por claridad.
  PERFORM set_config('app.void_payment_bypass', 'false', true);

  -- ── PASO 4: NOTA DE CRÉDITO SUNAT (código 07) — BEST-EFFORT ──────────────
  BEGIN
    SELECT i.*
    INTO   v_orig_invoice
    FROM   invoices i
    JOIN   transactions t ON t.invoice_id = i.id
    WHERE  t.metadata->>'recharge_request_id' = p_request_id::text
      AND  i.document_type_code IN ('01', '03')
      AND  i.sunat_status       <> 'voided'
    ORDER BY i.created_at DESC
    LIMIT  1;

    IF v_orig_invoice.id IS NOT NULL THEN
      v_serie_nc := 'NC' || SUBSTRING(v_orig_invoice.serie FROM 1 FOR 2);

      INSERT INTO invoices (
        school_id,
        transaction_id,
        document_type_code,
        serie,
        numero,
        client_name,
        client_document_type,
        client_document_number,
        client_address,
        client_email,
        subtotal,
        igv_amount,
        total_amount,
        sunat_status,
        is_demo,
        created_by,
        original_invoice_id
      ) VALUES (
        v_orig_invoice.school_id,
        NULL,
        '07',
        v_serie_nc,
        get_next_invoice_numero(v_orig_invoice.school_id, v_serie_nc),
        v_orig_invoice.client_name,
        v_orig_invoice.client_document_type,
        v_orig_invoice.client_document_number,
        v_orig_invoice.client_address,
        v_orig_invoice.client_email,
        v_orig_invoice.subtotal,
        v_orig_invoice.igv_amount,
        v_orig_invoice.total_amount,
        'pending',
        v_orig_invoice.is_demo,
        p_admin_id,
        v_orig_invoice.id
      )
      RETURNING id INTO v_credit_note_id;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'void_payment: Nota de Crédito no pudo crearse (no crítico): %', SQLERRM;
  END;

  -- ── PASO 5: AUDITORÍA — BEST-EFFORT ──────────────────────────────────────
  BEGIN
    INSERT INTO huella_digital_logs (
      usuario_id, accion, modulo, contexto, school_id, creado_at
    ) VALUES (
      p_admin_id,
      'ANULACION_PAGO',
      'COBRANZAS',
      jsonb_build_object(
        'request_id',        p_request_id,
        'request_type',      COALESCE(v_req.request_type, 'recharge'),
        'amount',            v_req.amount,
        'student_id',        v_req.student_id,
        'void_reason',       p_reason,
        'reverted_tx_ids',   to_jsonb(COALESCE(v_tx_ids, '{}'::uuid[])),
        'reverted_tx_count', v_reverted_tx_count,
        'reverted_lo_count', v_reverted_lo_count,
        'balance_deducted',  v_balance_deducted,
        'credit_note_id',    v_credit_note_id,
        'sunat_bypass_used', true
      ),
      v_req.school_id,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'void_payment: Auditoría falló (no crítico): %', SQLERRM;
  END;

  -- ── PASO 6: RETORNO ───────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',           true,
    'voided_request_id', p_request_id,
    'student_id',        v_req.student_id,
    'amount',            v_req.amount,
    'request_type',      COALESCE(v_req.request_type, 'recharge'),
    'reverted_tx_count', v_reverted_tx_count,
    'reverted_lo_count', v_reverted_lo_count,
    'balance_deducted',  v_balance_deducted,
    'credit_note_id',    v_credit_note_id
  );

END;
$$;

GRANT EXECUTE ON FUNCTION void_payment(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION void_payment IS
  'v2 (2026-04-13): Corrige bloqueo SUNAT-Guard con bypass autorizado (E3).
   - Activa app.void_payment_bypass=true (LOCAL) antes de los UPDATEs.
   - CASO B: NO toca billing_status ni is_taxable — la Nota de Crédito SUNAT
     es la reversión fiscal. Solo cambia payment_status+metadata.
   - El trigger E3 valida que amount e invoice_id no cambien nunca.';


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN: TEST de anulación con SUNAT-guard activo
-- Ejecutar manualmente en Supabase Studio para confirmar.
-- ════════════════════════════════════════════════════════════════════════════
/*

DO $$
DECLARE
  v_tx_id uuid := gen_random_uuid();
  v_inv_id uuid := gen_random_uuid();
BEGIN
  -- Simular una transacción ya enviada a SUNAT
  INSERT INTO transactions (
    id, type, amount, payment_status, payment_method,
    school_id, is_taxable, billing_status, invoice_id,
    metadata, created_at
  )
  SELECT
    v_tx_id, 'purchase', -13.50, 'paid', 'transferencia',
    id, true, 'sent', v_inv_id,
    jsonb_build_object(
      'recharge_request_id', '00000000-0000-0000-0000-000000000001',
      'source_channel',      'parent_web'
    ),
    now()
  FROM schools LIMIT 1;

  -- TEST A: Sin bypass → debe FALLAR
  BEGIN
    UPDATE transactions
    SET payment_status = 'pending'
    WHERE id = v_tx_id;
    RAISE NOTICE 'ERROR: UPDATE no bloqueado sin bypass';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK A: UPDATE bloqueado sin bypass. Mensaje: %', SQLERRM;
  END;

  -- TEST B: Con bypass → debe PASAR (solo payment_status y metadata)
  PERFORM set_config('app.void_payment_bypass', 'true', true);
  BEGIN
    UPDATE transactions
    SET payment_status = 'pending',
        payment_method = NULL,
        metadata = metadata || '{"voided": true}'::jsonb
    WHERE id = v_tx_id;
    RAISE NOTICE 'OK B: UPDATE permitido con bypass (void_payment autorizado).';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ERROR B: UPDATE bloqueado incluso con bypass: %', SQLERRM;
  END;
  PERFORM set_config('app.void_payment_bypass', 'false', true);

  -- TEST C: Con bypass, intentar cambiar amount → debe FALLAR
  PERFORM set_config('app.void_payment_bypass', 'true', true);
  BEGIN
    UPDATE transactions SET amount = -1.00 WHERE id = v_tx_id;
    RAISE NOTICE 'ERROR C: Cambio de amount no bloqueado incluso con bypass';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK C: amount bloqueado incluso con bypass. Mensaje: %', SQLERRM;
  END;
  PERFORM set_config('app.void_payment_bypass', 'false', true);

  -- Limpiar
  DELETE FROM transactions WHERE id = v_tx_id;
  RAISE NOTICE 'TEST COMPLETADO. Revisa los mensajes OK/ERROR arriba.';
END;
$$;

*/

SELECT '✅ SUNAT-Guard (E3) + void_payment v2 aplicados correctamente' AS status;
