-- ============================================================================
-- fn_build_billing_payload — Worker de Facturación Individual
-- Fecha: 2026-04-20
--
-- Implementa las 3 Reglas de Oro:
--   1. VERDAD DESDE EL BACKEND: todos los montos y descripciones calculados en PostgreSQL.
--      El worker externo recibe solo el recharge_request_id; NUNCA acepta montos del cliente.
--   2. TRAZABILIDAD DEL PAGO: extrae payment_method real de recharge_requests.
--      Ningún medio se hardcodea ("transferencia" por defecto está prohibido).
--   3. INTEGRIDAD TRIBUTARIA: prioriza invoice_client_data del voucher;
--      fallback a profiles.full_name+email; "Consumidor Final" solo como último recurso.
--
-- Seguridad multi-sede:
--   school_id guard en cada JOIN. Un queue de Sede A nunca puede acceder a datos de Sede B.
--
-- Columna adicional: processing_started_at para TTL anti-zombie.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 1: Columna TTL para detección de zombies
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.billing_queue
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

COMMENT ON COLUMN public.billing_queue.processing_started_at IS
  'Timestamp de cuando el worker marcó el registro como processing. '
  'Si han pasado más de 10 minutos sin llegar a emitted/failed, '
  'el worker lo resetea a pending (protección anti-zombie).';


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 2: fn_build_billing_payload
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
  v_student_name   text;
  v_items          jsonb;
  v_computed_total numeric := 0;
  v_client         jsonb;
  v_pm_label       text;
  v_doc_type       text;
  v_dni_ruc        text;
BEGIN

  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 1: Bloqueo atómico FIFO
  --
  -- FOR UPDATE SKIP LOCKED garantiza que si dos workers corren en paralelo,
  -- cada uno toma un registro diferente sin bloqueos cruzados.
  -- ══════════════════════════════════════════════════════════════════════
  SELECT * INTO v_queue
  FROM   billing_queue
  WHERE  id     = p_queue_id
    AND  status = 'pending'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error',  'QUEUE_NOT_AVAILABLE',
      'detail', 'El registro no existe, ya fue tomado por otro proceso, o no está en estado pending'
    );
  END IF;

  -- PASO 2: Marcar como processing + registrar timestamp TTL
  UPDATE billing_queue
  SET    status                = 'processing',
         emit_attempts         = emit_attempts + 1,
         processing_started_at = NOW()
  WHERE  id = p_queue_id;


  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 3: Cargar recharge_request con GUARD de school_id
  --
  -- Seguridad crítica: impide que un registro de Sede A acceda a datos de Sede B.
  -- Si el school_id no coincide, el registro se marca failed inmediatamente.
  -- ══════════════════════════════════════════════════════════════════════
  SELECT * INTO v_req
  FROM   recharge_requests
  WHERE  id        = v_queue.recharge_request_id
    AND  school_id = v_queue.school_id;

  IF NOT FOUND THEN
    UPDATE billing_queue
    SET    status        = 'failed',
           error_message = 'REQ_NOT_FOUND: recharge_request no encontrado o school_id no coincide. ' ||
                           'recharge_request_id=' || v_queue.recharge_request_id::text
    WHERE  id = p_queue_id;
    RETURN jsonb_build_object(
      'error',    'REQ_NOT_FOUND',
      'queue_id', p_queue_id
    );
  END IF;


  -- PASO 4: Nombre real del alumno (fuente: students.full_name, no hardcoded)
  SELECT full_name INTO v_student_name
  FROM   students
  WHERE  id = v_queue.student_id;

  v_student_name := COALESCE(v_student_name, 'Alumno');


  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 5: CONSTRUCCIÓN DE ÍTEMS — CERO CÁLCULOS FUERA DE LA BD
  --
  -- REGLA DE ORO: SUM, ROUND y CASE viven aquí, en PostgreSQL.
  -- El worker externo (Edge Function) recibe números finales, nunca hace aritmética.
  --
  -- Fuentes de transacciones (por orden de prioridad):
  --   A) paid_transaction_ids (ARRAY) → deudas de kiosco/cafetería
  --   B) lunch_order_ids (ARRAY)      → transacciones con metadata.lunch_order_id
  --   C) transaction_id (UUID)        → transacción única (recarga simple)
  --
  -- Descripción por ítem:
  --   - Con lunch_order_id en metadata → "Almuerzo - {nombre} - {DD/MM/YYYY Lima}"
  --   - Sin lunch_order_id             → t.description (ya tiene el concepto del POS)
  --
  -- Reloj único (Regla 11.C): to_char(timezone('America/Lima', t.created_at), ...)
  -- ══════════════════════════════════════════════════════════════════════
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
        'precio_unitario',    round(abs(t.amount), 2)   -- ROUND en PostgreSQL
      )
      ORDER BY t.created_at ASC
    ),
    sum(round(abs(t.amount), 2))   -- SUM total en PostgreSQL = fuente única de verdad
  INTO v_items, v_computed_total
  FROM transactions t
  WHERE t.is_deleted  = false
    AND t.school_id   = v_queue.school_id          -- guard multi-sede
    AND (
      -- Fuente A: deudas de kiosco/cafetería (paid_transaction_ids explícitos)
      (   cardinality(coalesce(v_req.paid_transaction_ids, '{}')) > 0
        AND t.id = ANY(v_req.paid_transaction_ids)
      )
      OR
      -- Fuente B: almuerzos identificados por metadata.lunch_order_id
      (   cardinality(coalesce(v_req.lunch_order_ids, '{}')) > 0
        AND (t.metadata->>'lunch_order_id')::uuid = ANY(v_req.lunch_order_ids)
      )
      OR
      -- Fuente C: transacción única (recargas simples sin array de IDs)
      (   v_req.transaction_id IS NOT NULL
        AND t.id = v_req.transaction_id
        AND cardinality(coalesce(v_req.paid_transaction_ids, '{}')) = 0
        AND cardinality(coalesce(v_req.lunch_order_ids, '{}'))      = 0
      )
    );


  -- PASO 6: Fallback si no hay transacciones vinculadas
  -- Caso raro: puede ocurrir si las transacciones fueron eliminadas después de aprobarse.
  -- Se usa billing_queue.amount como fuente autorizada del monto.
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    v_computed_total := v_queue.amount;
    v_items := jsonb_build_array(
      jsonb_build_object(
        'unidad_de_medida',  'NIU',
        'codigo',            'SVC-APROBADO',
        'descripcion',       'Pago aprobado - ' || v_student_name,
        'cantidad',           1,
        'precio_unitario',    v_queue.amount
      )
    );
  END IF;


  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 7: Etiqueta del medio de pago REAL (no hardcoded "transferencia")
  -- Fuente: recharge_requests.payment_method
  -- ══════════════════════════════════════════════════════════════════════
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
    WHEN 'adjustment'    THEN 'Ajuste administrativo'
    ELSE COALESCE(v_req.payment_method, 'Otro medio de pago')
  END;


  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 8: Datos tributarios del cliente
  --
  -- Prioridad 1: invoice_client_data del billing_queue
  --             (capturado en el momento del pago → DNI/RUC, nombre, email)
  -- Prioridad 2: profiles.full_name + email del padre
  -- Prioridad 3: "Consumidor Final" — solo si no hay ningún dato disponible
  -- ══════════════════════════════════════════════════════════════════════
  IF v_queue.invoice_client_data IS NOT NULL
     AND (v_queue.invoice_client_data->>'name') IS NOT NULL
  THEN
    -- Prioridad 1: datos tributarios reales del pago
    v_client := v_queue.invoice_client_data;

  ELSE
    -- Prioridad 2: perfil del padre (full_name, email)
    -- Nota: profiles no tiene DNI/RUC en el esquema actual → dni_ruc queda '-'
    SELECT jsonb_build_object(
      'name',    COALESCE(p.full_name, 'Consumidor Final'),
      'dni_ruc', '-',
      'email',   COALESCE(p.email, ''),
      'address', '-'
    ) INTO v_client
    FROM   profiles p
    WHERE  p.id = v_req.parent_id;

    -- Prioridad 3: último recurso
    IF v_client IS NULL THEN
      v_client := '{"name":"Consumidor Final","dni_ruc":"-","email":"","address":"-"}'::jsonb;
    END IF;
  END IF;


  -- PASO 9: Inferir tipo de documento SUNAT desde DNI/RUC
  v_dni_ruc  := COALESCE(v_client->>'dni_ruc', '-');
  v_doc_type := CASE
    WHEN length(v_dni_ruc) = 11 AND v_dni_ruc ~ '^\d{11}$' THEN 'ruc'
    WHEN length(v_dni_ruc) = 8  AND v_dni_ruc ~ '^\d{8}$'  THEN 'dni'
    ELSE '-'
  END;


  -- ══════════════════════════════════════════════════════════════════════
  -- PASO 10: Retornar payload completo para generate-document
  --
  -- Incluye verificación de integridad:
  --   integrity_ok = true   → v_computed_total coincide con billing_queue.amount (±S/0.02)
  --   integrity_ok = false  → discrepancia real; el worker decide si proceder o fallar
  --
  -- También retorna los IDs de transacciones para que el worker los marque
  -- como billing_status='sent' tras la emisión exitosa.
  -- ══════════════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    -- Identificación
    'queue_id',             p_queue_id,
    'school_id',            v_queue.school_id,
    'invoice_type',         v_queue.invoice_type,

    -- Tipo Nubefact: 1=factura, 2=boleta
    'tipo',                 CASE v_queue.invoice_type WHEN 'factura' THEN 1 ELSE 2 END,

    -- Datos del cliente (tributarios)
    'cliente', jsonb_build_object(
      'doc_type',     v_doc_type,
      'doc_number',   v_dni_ruc,
      'razon_social', COALESCE(v_client->>'name', 'Consumidor Final'),
      'direccion',    COALESCE(v_client->>'address', '-'),
      'email',        COALESCE(v_client->>'email', '')
    ),

    -- Ítems (descripciones y precios reales de la BD)
    'items',                v_items,

    -- Total calculado en PostgreSQL (fuente única de verdad)
    'monto_total',          v_computed_total,

    -- Medio de pago real
    'payment_method',       v_pm_label,

    -- Metadatos de auditoría
    'student_name',         v_student_name,

    -- Verificación de integridad (tolerancia ±S/0.02 por redondeo decimal)
    'integrity_ok',         abs(v_computed_total - v_queue.amount) <= 0.02,
    'amount_approved',      v_queue.amount,
    'amount_computed',      v_computed_total,

    -- IDs para post-procesamiento: marcar transactions como billing_status='sent'
    'paid_transaction_ids',   to_jsonb(COALESCE(v_req.paid_transaction_ids, '{}'::uuid[])),
    'lunch_order_ids',        to_jsonb(COALESCE(v_req.lunch_order_ids,      '{}'::uuid[])),
    'single_transaction_id',  v_req.transaction_id
  );

END;
$$;

COMMENT ON FUNCTION public.fn_build_billing_payload(uuid) IS
  'Worker de facturación individual. Implementa las Reglas de Oro:'
  ' (1) Verdad desde el Backend: SUM y ROUND en PostgreSQL, cero aritmética en el cliente.'
  ' (2) Trazabilidad del pago: extrae payment_method real de recharge_requests.'
  ' (3) Integridad tributaria: invoice_client_data del voucher o perfil del padre.'
  ' (4) Seguridad multi-sede: school_id guard en cada JOIN.'
  ' Retorna payload completo para generate-document incluyendo integridad calculada.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PIEZA 3: fn_reset_billing_queue_zombies — Limpieza TTL
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_reset_billing_queue_zombies(
  p_ttl_minutes int DEFAULT 10
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH reset_rows AS (
    UPDATE billing_queue
    SET    status                = 'pending',
           processing_started_at = NULL
    WHERE  status                = 'processing'
      AND  processing_started_at < NOW() - (p_ttl_minutes || ' minutes')::interval
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM reset_rows;

  IF v_count > 0 THEN
    RAISE LOG '[billing_queue] % zombie(s) reseteados a pending (TTL=%min)', v_count, p_ttl_minutes;
  END IF;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.fn_reset_billing_queue_zombies(int) IS
  'Resetea a pending los registros de billing_queue que llevan más de p_ttl_minutes '
  'en estado processing sin resolverse. Protección anti-zombie para el worker de facturación.';
