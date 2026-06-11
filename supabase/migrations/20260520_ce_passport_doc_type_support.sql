-- ============================================================================
-- SOPORTE CARNET DE EXTRANJERÍA Y PASAPORTE EN FACTURACIÓN ELECTRÓNICA
-- Fecha: 2026-05-20
--
-- Problema:
--   fn_build_billing_payload infería el tipo de documento SUNAT únicamente
--   por longitud (8 dígitos → DNI, 11 dígitos → RUC). Documentos de
--   extranjeros (CE, Pasaporte) se perdían como '-' (sin documento) aunque
--   el padre los hubiera ingresado en el portal.
--
-- Solución (SOLO ADITIVA — no se eliminan ramas existentes):
--   1. Leer campo 'doc_type' explícito desde invoice_client_data si existe.
--   2. Leer campo 'doc_number' como fallback de 'dni_ruc' (las dos rutas
--      del sistema usan claves distintas).
--   3. Leer 'razon_social' como fallback de 'name' (misma inconsistencia de rutas).
--   4. La inferencia por longitud se mantiene intacta como fallback legacy.
--
-- Valores válidos de doc_type:
--   'dni'       → código Nubefact 1
--   'ruc'       → código Nubefact 6
--   'ce'        → código Nubefact 4  (Carnet de Extranjería SUNAT)
--   'pasaporte' → código Nubefact 7
--
-- Esta migración solo CREATE OR REPLACE la función vigente (v4).
-- No toca lógica de IziPay, pasarela, ni saldos.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_build_billing_payload(p_queue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue          record;
  v_req            record;
  v_direct_tx      record;
  v_student_name   text;
  v_items          jsonb;
  v_computed_total numeric := 0;
  v_client         jsonb;
  v_pm_label       text;
  v_doc_type       text;
  v_dni_ruc        text;
  v_explicit_type  text;
  v_paid_tx_ids    jsonb := '[]'::jsonb;
  v_lunch_ids      jsonb := '[]'::jsonb;
  v_single_tx_id   uuid  := NULL;
BEGIN

  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 1: Bloqueo atómico FIFO
  -- ══════════════════════════════════════════════════════════════════════
  SELECT * INTO v_queue
  FROM   billing_queue
  WHERE  id     = p_queue_id
    AND  status = 'pending'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error',  'QUEUE_NOT_AVAILABLE',
      'detail', 'No existe, ya fue tomado por otro proceso, o no está en pending'
    );
  END IF;

  UPDATE billing_queue
  SET    status                = 'processing',
         emit_attempts         = emit_attempts + 1,
         processing_started_at = NOW()
  WHERE  id = p_queue_id;

  SELECT full_name INTO v_student_name
  FROM   students
  WHERE  id = v_queue.student_id;
  v_student_name := COALESCE(v_student_name, 'Alumno');

  -- ══════════════════════════════════════════════════════════════════════
  -- CAMINO A: Voucher manual (recharge_request_id NOT NULL)
  -- ══════════════════════════════════════════════════════════════════════
  IF v_queue.recharge_request_id IS NOT NULL THEN
    SELECT * INTO v_req
    FROM   recharge_requests
    WHERE  id        = v_queue.recharge_request_id
      AND  school_id = v_queue.school_id;

    IF NOT FOUND THEN
      UPDATE billing_queue
      SET    status        = 'failed',
             error_message = 'REQ_NOT_FOUND: recharge_request no encontrado o school_id no coincide. id='
                             || COALESCE(v_queue.recharge_request_id::text, 'NULL')
      WHERE  id = p_queue_id;
      RETURN jsonb_build_object('error', 'REQ_NOT_FOUND', 'queue_id', p_queue_id);
    END IF;

    SELECT
      jsonb_agg(
        jsonb_build_object(
          'unidad_de_medida', 'NIU',
          'codigo',           COALESCE(t.ticket_code, 'SVC-' || substr(t.id::text, 1, 8)),
          'descripcion',      CASE
            WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN
              'Almuerzo - ' || v_student_name || ' - ' ||
              to_char(timezone('America/Lima', t.created_at), 'DD/MM/YYYY')
            ELSE
              COALESCE(
                nullif(trim(t.description), ''),
                'Servicio cafetería - ' || v_student_name || ' - ' ||
                to_char(timezone('America/Lima', t.created_at), 'DD/MM/YYYY')
              )
          END,
          'cantidad',        1,
          'precio_unitario', round(abs(t.amount), 2)
        )
        ORDER BY t.created_at ASC
      ),
      sum(round(abs(t.amount), 2))
    INTO v_items, v_computed_total
    FROM transactions t
    WHERE t.is_deleted = false
      AND t.school_id = v_queue.school_id
      AND (
        ( cardinality(coalesce(v_req.paid_transaction_ids, '{}')) > 0
          AND t.id = ANY(v_req.paid_transaction_ids) )
        OR
        ( cardinality(coalesce(v_req.lunch_order_ids, '{}')) > 0
          AND (t.metadata->>'lunch_order_id')::uuid = ANY(v_req.lunch_order_ids) )
        OR
        ( v_req.transaction_id IS NOT NULL
          AND t.id = v_req.transaction_id
          AND cardinality(coalesce(v_req.paid_transaction_ids, '{}')) = 0
          AND cardinality(coalesce(v_req.lunch_order_ids, '{}')) = 0 )
      );

    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
      v_computed_total := v_queue.amount;
      v_items := jsonb_build_array(jsonb_build_object(
        'unidad_de_medida', 'NIU',
        'codigo',           'SVC-APROBADO',
        'descripcion',      'Pago aprobado - ' || v_student_name,
        'cantidad',         1,
        'precio_unitario',  v_queue.amount
      ));
    END IF;

    v_pm_label := CASE v_req.payment_method
      WHEN 'yape_qr'       THEN 'Yape'
      WHEN 'yape_numero'   THEN 'Yape'
      WHEN 'yape'          THEN 'Yape'
      WHEN 'plin_qr'       THEN 'Plin'
      WHEN 'plin_numero'   THEN 'Plin'
      WHEN 'plin'          THEN 'Plin'
      WHEN 'transferencia' THEN 'Transferencia bancaria'
      WHEN 'tarjeta'       THEN 'Tarjeta de crédito/débito'
      WHEN 'izipay'        THEN 'Tarjeta (IziPay)'
      WHEN 'efectivo'      THEN 'Efectivo'
      WHEN 'saldo'         THEN 'Saldo electrónico'
      ELSE COALESCE(v_req.payment_method, 'Otro medio de pago')
    END;

    -- Datos del cliente: prioridad invoice_client_data, luego perfil del padre
    -- Se acepta 'name' (clave de ruta IziPay) o 'razon_social' (clave de ruta portal)
    IF v_queue.invoice_client_data IS NOT NULL
       AND (
         (v_queue.invoice_client_data->>'name')        IS NOT NULL
         OR (v_queue.invoice_client_data->>'razon_social') IS NOT NULL
       )
    THEN
      v_client := v_queue.invoice_client_data;
    ELSE
      SELECT jsonb_build_object(
        'name',    COALESCE(p.full_name, 'Consumidor Final'),
        'dni_ruc', '-',
        'email',   COALESCE(p.email, ''),
        'address', '-'
      ) INTO v_client
      FROM profiles p
      WHERE p.id = v_req.parent_id;

      IF v_client IS NULL THEN
        v_client := '{"name":"Consumidor Final","dni_ruc":"-","email":"","address":"-"}'::jsonb;
      END IF;
    END IF;

    v_paid_tx_ids  := to_jsonb(COALESCE(v_req.paid_transaction_ids, '{}'::uuid[]));
    v_lunch_ids    := to_jsonb(COALESCE(v_req.lunch_order_ids,      '{}'::uuid[]));
    v_single_tx_id := v_req.transaction_id;

  -- ══════════════════════════════════════════════════════════════════════
  -- CAMINO B: Gateway directo (transaction_id sin recharge_request)
  -- ══════════════════════════════════════════════════════════════════════
  ELSIF v_queue.transaction_id IS NOT NULL THEN

    SELECT t.amount, t.description, t.metadata, t.created_at, t.payment_method, t.ticket_code
    INTO   v_direct_tx
    FROM   transactions t
    WHERE  t.id        = v_queue.transaction_id
      AND  t.school_id = v_queue.school_id;

    IF NOT FOUND THEN
      UPDATE billing_queue
      SET    status        = 'failed',
             error_message = 'TX_NOT_FOUND: transaction no encontrada o school_id no coincide. '
                             'transaction_id=' || COALESCE(v_queue.transaction_id::text, 'NULL')
      WHERE  id = p_queue_id;
      RETURN jsonb_build_object('error', 'TX_NOT_FOUND', 'queue_id', p_queue_id);
    END IF;

    v_computed_total := round(abs(v_direct_tx.amount), 2);
    v_items := jsonb_build_array(jsonb_build_object(
      'unidad_de_medida', 'NIU',
      'codigo',           COALESCE(v_direct_tx.ticket_code,
                            'OL-' || substr(v_queue.transaction_id::text, 1, 8)),
      'descripcion',      COALESCE(
        nullif(trim(v_direct_tx.description), ''),
        'Recarga en línea - ' || v_student_name ||
        ' - ' || to_char(timezone('America/Lima', v_direct_tx.created_at), 'DD/MM/YYYY')
      ),
      'cantidad',         1,
      'precio_unitario',  v_computed_total
    ));

    v_pm_label := CASE v_direct_tx.payment_method
      WHEN 'tarjeta'         THEN 'Tarjeta de crédito/débito (IziPay)'
      WHEN 'card'            THEN 'Tarjeta de crédito/débito (IziPay)'
      WHEN 'card_visa'       THEN 'Tarjeta Visa (IziPay)'
      WHEN 'card_mastercard' THEN 'Tarjeta Mastercard (IziPay)'
      WHEN 'yape_qr'         THEN 'Yape'
      WHEN 'yape'            THEN 'Yape'
      WHEN 'plin'            THEN 'Plin'
      WHEN 'transferencia'   THEN 'Transferencia bancaria'
      ELSE COALESCE(v_direct_tx.payment_method, 'Tarjeta (IziPay)')
    END;

    IF v_queue.invoice_client_data IS NOT NULL
       AND (
         (v_queue.invoice_client_data->>'name')        IS NOT NULL
         OR (v_queue.invoice_client_data->>'razon_social') IS NOT NULL
       )
    THEN
      v_client := v_queue.invoice_client_data;
    ELSE
      v_client := '{"name":"Consumidor Final","dni_ruc":"-","email":"","address":"-"}'::jsonb;
    END IF;

    v_single_tx_id := v_queue.transaction_id;

  ELSE
    UPDATE billing_queue
    SET    status        = 'failed',
           error_message = 'INVALID_QUEUE: el registro no tiene recharge_request_id ni transaction_id'
    WHERE  id = p_queue_id;
    RETURN jsonb_build_object('error', 'INVALID_QUEUE', 'queue_id', p_queue_id);
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 9: Resolución de tipo de documento SUNAT (v4 — CE/Pasaporte)
  --
  -- Prioridad 1: campo 'doc_type' explícito en invoice_client_data.
  --   Acepta: 'ce', 'pasaporte', 'dni', 'ruc'
  --   Clave nueva del portal: 'doc_number'
  --   Clave legacy de IziPay:  'dni_ruc'
  --
  -- Prioridad 2: inferencia por longitud (fallback legacy — no se elimina).
  --   8 dígitos numéricos → dni
  --   11 dígitos numéricos → ruc
  -- ══════════════════════════════════════════════════════════════════════

  -- Número de documento: acepta 'doc_number' (portal) o 'dni_ruc' (IziPay)
  v_dni_ruc := COALESCE(
    nullif(trim(v_client->>'doc_number'), ''),
    nullif(trim(v_client->>'dni_ruc'),    ''),
    '-'
  );

  -- Tipo de documento: explícito primero, inferencia por longitud como fallback
  v_explicit_type := lower(trim(COALESCE(v_client->>'doc_type', '')));

  v_doc_type := CASE
    WHEN v_explicit_type IN ('ce', 'pasaporte', 'dni', 'ruc') THEN v_explicit_type
    WHEN length(v_dni_ruc) = 11 AND v_dni_ruc ~ '^\d{11}$'   THEN 'ruc'
    WHEN length(v_dni_ruc) = 8  AND v_dni_ruc ~ '^\d{8}$'    THEN 'dni'
    ELSE '-'
  END;

  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 10: Payload para generate-document
  -- ══════════════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'queue_id',              p_queue_id,
    'school_id',             v_queue.school_id,
    'invoice_type',          v_queue.invoice_type,
    'tipo',                  CASE v_queue.invoice_type WHEN 'factura' THEN 1 ELSE 2 END,
    'cliente', jsonb_build_object(
      'doc_type',     v_doc_type,
      'doc_number',   v_dni_ruc,
      -- Acepta 'name' (IziPay) o 'razon_social' (portal) como fuente del nombre
      'razon_social', COALESCE(
                        nullif(trim(v_client->>'name'),        ''),
                        nullif(trim(v_client->>'razon_social'),''),
                        'Consumidor Final'
                      ),
      'direccion',    COALESCE(nullif(trim(v_client->>'address'),  ''),
                               nullif(trim(v_client->>'direccion'),''),
                               '-'),
      'email',        COALESCE(v_client->>'email', '')
    ),
    'items',                 v_items,
    'monto_total',           v_computed_total,
    'payment_method',        v_pm_label,
    'student_name',          v_student_name,
    'integrity_ok',          abs(v_computed_total - v_queue.amount) <= 0.02,
    'amount_approved',       v_queue.amount,
    'amount_computed',       v_computed_total,
    'paid_transaction_ids',  v_paid_tx_ids,
    'lunch_order_ids',       v_lunch_ids,
    'single_transaction_id', v_single_tx_id
  );

END;
$$;

COMMENT ON FUNCTION public.fn_build_billing_payload(uuid) IS
  'v4 — Soporte CE/Pasaporte: doc_type explícito desde invoice_client_data; '
  'fallback por longitud (8/11 dígitos) conservado para compatibilidad legacy. '
  'Acepta claves "doc_number"/"doc_type" (portal) y "dni_ruc" (IziPay) de forma unificada.';
