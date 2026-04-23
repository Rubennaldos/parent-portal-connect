-- ============================================================================
-- Facturación en Tiempo Real — Arquitectura Completa
-- Fecha: 2026-04-20
--
-- PIEZAS:
--   1. ALTER billing_queue: recharge_request_id nullable + columna transaction_id
--      Permite que pagos IziPay/gateway (sin recharge_request) usen la cola.
--
--   2. fn_build_billing_payload v2:
--      Camino A: Voucher manual → recharge_request_id + paid_transaction_ids/lunch_order_ids
--      Camino B: Pago gateway  → transaction_id directo (sin recharge_request)
--
--   3. fn_billing_queue_webhook: trigger AFTER INSERT en billing_queue
--      Dispara net.http_post() async → process-billing-queue con queue_id específico
--      para procesamiento INMEDIATO (latencia objetivo < 10 segundos).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 1: Ajustes de esquema
-- ─────────────────────────────────────────────────────────────────────────────

-- Hacer recharge_request_id nullable
-- Pagos IziPay acreditan directo a transactions, sin pasar por recharge_requests.
ALTER TABLE public.billing_queue
  ALTER COLUMN recharge_request_id DROP NOT NULL;

-- Columna transaction_id para el camino directo (IziPay/gateway)
ALTER TABLE public.billing_queue
  ADD COLUMN IF NOT EXISTS transaction_id uuid
    REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_queue_transaction
  ON public.billing_queue (transaction_id)
  WHERE transaction_id IS NOT NULL;

COMMENT ON COLUMN public.billing_queue.transaction_id IS
  'FK a transactions para el camino gateway (IziPay). '
  'Cuando recharge_request_id IS NULL, este campo es la fuente de verdad del pago.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 2: fn_build_billing_payload v2
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- para el payload final
  v_paid_tx_ids    jsonb  := '[]'::jsonb;
  v_lunch_ids      jsonb  := '[]'::jsonb;
  v_single_tx_id   uuid   := NULL;
BEGIN

  -- ── PASO 1: Bloqueo atómico FIFO ─────────────────────────────────────
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

  -- ── PASO 2: Marcar processing ─────────────────────────────────────────
  UPDATE billing_queue
  SET    status                = 'processing',
         emit_attempts         = emit_attempts + 1,
         processing_started_at = NOW()
  WHERE  id = p_queue_id;

  -- ── PASO 3: Nombre real del alumno ────────────────────────────────────
  SELECT full_name INTO v_student_name
  FROM   students
  WHERE  id = v_queue.student_id;
  v_student_name := COALESCE(v_student_name, 'Alumno');


  -- ══════════════════════════════════════════════════════════════════════
  -- CAMINO A: Voucher manual (recharge_request_id IS NOT NULL)
  -- ══════════════════════════════════════════════════════════════════════
  IF v_queue.recharge_request_id IS NOT NULL THEN

    SELECT * INTO v_req
    FROM   recharge_requests
    WHERE  id        = v_queue.recharge_request_id
      AND  school_id = v_queue.school_id;

    IF NOT FOUND THEN
      UPDATE billing_queue
      SET    status        = 'failed',
             error_message = 'REQ_NOT_FOUND: recharge_request no encontrado o school_id '
                             'no coincide. id=' || v_queue.recharge_request_id::text
      WHERE  id = p_queue_id;
      RETURN jsonb_build_object('error', 'REQ_NOT_FOUND', 'queue_id', p_queue_id);
    END IF;

    -- Construir ítems desde transactions (CERO cálculos fuera de la BD)
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'unidad_de_medida',  'NIU',
          'codigo',            COALESCE(t.ticket_code, 'SVC-' || substr(t.id::text, 1, 8)),
          'descripcion',       CASE
            WHEN (t.metadata->>'lunch_order_id') IS NOT NULL
              THEN 'Almuerzo - ' || v_student_name ||
                   ' - ' || to_char(timezone('America/Lima', t.created_at), 'DD/MM/YYYY')
            ELSE
              COALESCE(
                nullif(trim(t.description), ''),
                'Servicio cafetería - ' || v_student_name ||
                ' - ' || to_char(timezone('America/Lima', t.created_at), 'DD/MM/YYYY')
              )
          END,
          'cantidad',           1,
          'precio_unitario',    round(abs(t.amount), 2)
        )
        ORDER BY t.created_at ASC
      ),
      sum(round(abs(t.amount), 2))
    INTO v_items, v_computed_total
    FROM transactions t
    WHERE t.is_deleted  = false
      AND t.school_id   = v_queue.school_id
      AND (
        (   cardinality(coalesce(v_req.paid_transaction_ids, '{}')) > 0
          AND t.id = ANY(v_req.paid_transaction_ids)
        )
        OR
        (   cardinality(coalesce(v_req.lunch_order_ids, '{}')) > 0
          AND (t.metadata->>'lunch_order_id')::uuid = ANY(v_req.lunch_order_ids)
        )
        OR
        (   v_req.transaction_id IS NOT NULL
          AND t.id = v_req.transaction_id
          AND cardinality(coalesce(v_req.paid_transaction_ids, '{}')) = 0
          AND cardinality(coalesce(v_req.lunch_order_ids, '{}'))      = 0
        )
      );

    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
      v_computed_total := v_queue.amount;
      v_items := jsonb_build_array(jsonb_build_object(
        'unidad_de_medida', 'NIU', 'codigo', 'SVC-APROBADO',
        'descripcion', 'Pago aprobado - ' || v_student_name,
        'cantidad', 1, 'precio_unitario', v_queue.amount
      ));
    END IF;

    -- Medio de pago real desde recharge_requests
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

    -- Datos tributarios del cliente
    IF v_queue.invoice_client_data IS NOT NULL
       AND (v_queue.invoice_client_data->>'name') IS NOT NULL
    THEN
      v_client := v_queue.invoice_client_data;
    ELSE
      SELECT jsonb_build_object(
        'name',    COALESCE(p.full_name, 'Consumidor Final'),
        'dni_ruc', '-',
        'email',   COALESCE(p.email, ''),
        'address', '-'
      ) INTO v_client
      FROM profiles p WHERE p.id = v_req.parent_id;
      IF v_client IS NULL THEN
        v_client := '{"name":"Consumidor Final","dni_ruc":"-","email":"","address":"-"}'::jsonb;
      END IF;
    END IF;

    v_paid_tx_ids  := to_jsonb(COALESCE(v_req.paid_transaction_ids, '{}'::uuid[]));
    v_lunch_ids    := to_jsonb(COALESCE(v_req.lunch_order_ids,      '{}'::uuid[]));
    v_single_tx_id := v_req.transaction_id;


  -- ══════════════════════════════════════════════════════════════════════
  -- CAMINO B: Pago gateway directo (transaction_id sin recharge_request)
  --   Usado por IziPay y cualquier gateway que no pase por voucher manual.
  -- ══════════════════════════════════════════════════════════════════════
  ELSIF v_queue.transaction_id IS NOT NULL THEN

    SELECT t.amount, t.description, t.metadata,
           t.created_at, t.payment_method, t.ticket_code
    INTO   v_direct_tx
    FROM   transactions t
    WHERE  t.id        = v_queue.transaction_id
      AND  t.school_id = v_queue.school_id;

    IF NOT FOUND THEN
      UPDATE billing_queue
      SET    status        = 'failed',
             error_message = 'TX_NOT_FOUND: transaction no encontrada o school_id no coincide. '
                             'transaction_id=' || v_queue.transaction_id::text
      WHERE  id = p_queue_id;
      RETURN jsonb_build_object('error', 'TX_NOT_FOUND', 'queue_id', p_queue_id);
    END IF;

    -- Ítem único desde la transacción real
    v_computed_total := round(abs(v_direct_tx.amount), 2);
    v_items := jsonb_build_array(jsonb_build_object(
      'unidad_de_medida',  'NIU',
      'codigo',            COALESCE(v_direct_tx.ticket_code,
                             'OL-' || substr(v_queue.transaction_id::text, 1, 8)),
      'descripcion',       COALESCE(
        nullif(trim(v_direct_tx.description), ''),
        'Recarga en línea - ' || v_student_name ||
        ' - ' || to_char(timezone('America/Lima', v_direct_tx.created_at), 'DD/MM/YYYY')
      ),
      'cantidad',           1,
      'precio_unitario',    v_computed_total
    ));

    -- Medio de pago desde transactions.payment_method (fuente real del gateway)
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

    -- Datos tributarios del cliente
    IF v_queue.invoice_client_data IS NOT NULL
       AND (v_queue.invoice_client_data->>'name') IS NOT NULL
    THEN
      v_client := v_queue.invoice_client_data;
    ELSE
      v_client := '{"name":"Consumidor Final","dni_ruc":"-","email":"","address":"-"}'::jsonb;
    END IF;

    v_single_tx_id := v_queue.transaction_id;


  ELSE
    -- Registro inválido: ni recharge_request_id ni transaction_id
    UPDATE billing_queue
    SET    status        = 'failed',
           error_message = 'INVALID_QUEUE: el registro no tiene recharge_request_id ni transaction_id'
    WHERE  id = p_queue_id;
    RETURN jsonb_build_object('error', 'INVALID_QUEUE', 'queue_id', p_queue_id);
  END IF;


  -- ══════════════════════════════════════════════════════════════════════
  -- PASO FINAL: Construir payload para generate-document
  -- Incluye verificación de integridad de monto (aprobado vs calculado en BD)
  -- ══════════════════════════════════════════════════════════════════════

  -- Inferir tipo de documento SUNAT desde DNI/RUC
  v_dni_ruc  := COALESCE(v_client->>'dni_ruc', '-');
  v_doc_type := CASE
    WHEN length(v_dni_ruc) = 11 AND v_dni_ruc ~ '^\d{11}$' THEN 'ruc'
    WHEN length(v_dni_ruc) = 8  AND v_dni_ruc ~ '^\d{8}$'  THEN 'dni'
    ELSE '-'
  END;

  RETURN jsonb_build_object(
    'queue_id',             p_queue_id,
    'school_id',            v_queue.school_id,
    'invoice_type',         v_queue.invoice_type,
    'tipo',                 CASE v_queue.invoice_type WHEN 'factura' THEN 1 ELSE 2 END,
    'cliente', jsonb_build_object(
      'doc_type',     v_doc_type,
      'doc_number',   v_dni_ruc,
      'razon_social', COALESCE(v_client->>'name', 'Consumidor Final'),
      'direccion',    COALESCE(v_client->>'address', '-'),
      'email',        COALESCE(v_client->>'email', '')
    ),
    'items',                v_items,
    'monto_total',          v_computed_total,
    'payment_method',       v_pm_label,
    'student_name',         v_student_name,
    'integrity_ok',         abs(v_computed_total - v_queue.amount) <= 0.02,
    'amount_approved',      v_queue.amount,
    'amount_computed',      v_computed_total,
    'paid_transaction_ids', v_paid_tx_ids,
    'lunch_order_ids',      v_lunch_ids,
    'single_transaction_id', v_single_tx_id
  );

END;
$$;

COMMENT ON FUNCTION public.fn_build_billing_payload(uuid) IS
  'v2 — Worker de facturación individual. Camino A: voucher manual '
  '(recharge_request_id + paid_transaction_ids/lunch_order_ids). '
  'Camino B: gateway directo (transaction_id, para IziPay). '
  'Reglas de Oro: SUM/ROUND en PostgreSQL, payment_method real, school_id guard.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 3: Trigger en tiempo real — billing_queue INSERT → process-billing-queue
--
-- CÓMO FUNCIONA:
--   1. El padre paga (IziPay o voucher aprobado)
--   2. Se inserta un registro en billing_queue (pending)
--   3. Este trigger dispara net.http_post() ASYNC hacia process-billing-queue
--      pasando el queue_id específico
--   4. process-billing-queue procesa ESE registro con prioridad
--   5. El PDF está disponible en < 10 segundos
--
-- SEGURIDAD:
--   - net.http_post() es no-blocking: no retrasa el INSERT original
--   - Si pg_net falla, el EXCEPTION HANDLER logea y permite continuar
--   - Fallback: el cron de 5 minutos procesa registros que el webhook no completó
--
-- URL: https://duxqzozoahvrvqseinji.supabase.co (proyecto Lima_cafe_28)
--   Si el proyecto cambia, actualizar aquí O configurar vía Dashboard → Webhooks.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_billing_queue_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Llamada HTTP async (no bloquea la transacción INSERT)
  -- process-billing-queue recibirá queue_id y procesará solo ese registro.
  PERFORM net.http_post(
    url     := 'https://duxqzozoahvrvqseinji.supabase.co/functions/v1/process-billing-queue',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'queue_id',     NEW.id,
      'source',       'db_webhook',
      'school_id',    NEW.school_id,
      'invoice_type', NEW.invoice_type
    )
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Si pg_net no está disponible o hay error de red, no bloquear el INSERT.
    -- El fallback es el cron de 5 minutos que procesa pending records.
    RAISE LOG '[billing_queue_webhook] pg_net no disponible para queue_id=%: %',
              NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_billing_queue_webhook() IS
  'Trigger AFTER INSERT en billing_queue. Dispara net.http_post() async '
  'hacia process-billing-queue con el queue_id específico. '
  'No bloquea la transacción INSERT (PERFORM + EXCEPTION HANDLER). '
  'Latencia objetivo: < 10 segundos desde el pago hasta el PDF.';

DROP TRIGGER IF EXISTS tg_billing_queue_realtime ON public.billing_queue;

CREATE TRIGGER tg_billing_queue_realtime
  AFTER INSERT ON public.billing_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_billing_queue_webhook();

COMMENT ON TRIGGER tg_billing_queue_realtime ON public.billing_queue IS
  'Latencia cero: dispara process-billing-queue al INSERT. '
  'Cubre pagos manuales (process_traditional_voucher_approval) e IziPay. '
  'Fallback: cron de 5 min para registros que el webhook no completó.';
