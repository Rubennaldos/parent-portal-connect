-- ============================================================================
-- FASE 1B — RPC PORTÓN: enqueue_billing_emission
-- Proyecto: Lima Café 28  ·  Fecha: 2026-06-21
-- ============================================================================
--
-- QUÉ HACE (en simple):
--   Es el ÚNICO punto de entrada autorizado para insertar trabajos nuevos
--   en la cola de facturación (billing_queue). Nadie más escribe en la cola.
--   Garantiza:
--     · Idempotencia: el mismo voucher/tx nunca genera dos filas en la cola.
--     · Fecha de venta congelada en hora Lima al momento de encolar.
--     · Marcado de transactions como 'queued' (sin correlativo aún).
--
-- ALCANCE ACTUAL (Fase 1B):
--   · job_type = 'voucher': vouchers aprobados con datos tributarios.
--     Siempre tienen recharge_request_id → coincide con la FK NOT NULL.
--   · POS, gateway_tx, daily_summary → Fase 2 (requieren hacer nullable
--     recharge_request_id, que es una migración de mayor riesgo).
--
-- DISEÑO DE IDEMPOTENCIA:
--   · idempotency_key = md5(job_type || '|' || recharge_request_id)
--   · ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
--   · El índice es PARCIAL (solo filas NOT NULL) → las filas legacy (NULL) nunca
--     chocan. Si se llama dos veces, el segundo INSERT es silencioso.
--
-- POR QUÉ NO SE PONE payload_snapshot AQUÍ (decisión documentada):
--   · fn_build_billing_payload ya construye el payload completo (JOINs, validaciones,
--     cálculo de total). Duplicar esa lógica aquí violaría DRY y crearía dos
--     fuentes de verdad del payload.
--   · El worker detecta la ausencia de payload_snapshot y usa el camino legacy
--     (fn_build_billing_payload) sin intervención. Seguro y retrocompatible.
--   · Cuando Fase 2 introduzca pos_sale / gateway_tx, SÍ valdrá la pena construir
--     el snapshot aquí, porque esos flujos no tienen fn_build_billing_payload.
--
-- DEPENDE DE:
--   · 20260621_fase1a (columnas idempotency_key, job_type, emission_date,
--     days_since_sale, transaction_ids en billing_queue).
--   · Estado 'queued' en transactions.billing_status (también de 1A).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_billing_emission(
  p_recharge_request_id  uuid,
  p_school_id            uuid,
  p_job_type             text DEFAULT 'voucher'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req              public.recharge_requests;
  v_student_id       uuid;
  v_idem_key         text;
  v_emission_date    date;
  v_days_since_sale  int;
  v_new_id           uuid;
  v_tx_ids           uuid[];
BEGIN
  -- ── 1. Validar job_type ────────────────────────────────────────────────────
  IF p_job_type NOT IN ('voucher', 'gateway_tx', 'pos_sale', 'daily_summary', 'manual', 'credit_note') THEN
    RETURN jsonb_build_object('error', 'INVALID_JOB_TYPE', 'job_type', p_job_type);
  END IF;

  -- ── 2. Leer y validar el recharge_request ─────────────────────────────────
  SELECT * INTO v_req
  FROM   public.recharge_requests
  WHERE  id        = p_recharge_request_id
    AND  school_id = p_school_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error',  'REQ_NOT_FOUND',
      'detail', 'recharge_request no encontrado o school_id no coincide. id=' ||
                COALESCE(p_recharge_request_id::text, 'NULL')
    );
  END IF;

  -- Solo se encolan vouchers aprobados con datos tributarios (invoice_client_data)
  IF v_req.status NOT IN ('approved') THEN
    RETURN jsonb_build_object(
      'error',  'REQ_NOT_APPROVED',
      'detail', 'Solo se encolan vouchers aprobados. status=' || COALESCE(v_req.status, 'NULL')
    );
  END IF;

  IF v_req.invoice_client_data IS NULL THEN
    RETURN jsonb_build_object(
      'error',  'NO_INVOICE_CLIENT_DATA',
      'detail', 'El voucher no contiene datos tributarios. Sin DNI/RUC no se puede encolar.'
    );
  END IF;

  v_student_id := v_req.student_id;

  -- ── 3. Fecha Lima y antigüedad (reloj único de BD, Regla 11.C) ────────────
  v_emission_date   := timezone('America/Lima', now())::date;
  v_days_since_sale := GREATEST(0,
    v_emission_date - timezone('America/Lima', v_req.created_at)::date
  );

  -- Bloqueo preventivo: encolar un job que ya es extemporáneo no tiene sentido.
  -- Se puede forzar via admin (gestión manual), pero el flujo estándar lo rechaza.
  IF v_days_since_sale > 7 THEN
    RETURN jsonb_build_object(
      'error',         'EXTEMPORANEO',
      'detail',        'El voucher tiene ' || v_days_since_sale || ' días. '
                       'SUNAT solo acepta documentos de hasta 7 días. '
                       'Gestionar manualmente con el contador.',
      'days_elapsed',  v_days_since_sale
    );
  END IF;

  -- ── 4. Clave de idempotencia determinística ────────────────────────────────
  -- md5(job_type || '|' || recharge_request_id) es estable: la misma solicitud
  -- siempre genera la misma clave. El índice parcial la hace única para filas
  -- NOT NULL (las filas legacy con NULL quedan fuera del índice y no colisionan).
  v_idem_key := md5(p_job_type || '|' || p_recharge_request_id::text);

  -- ── 5. Recolectar IDs de transactions vinculadas ───────────────────────────
  -- Para marcarlas 'queued' y para auditoría.
  SELECT ARRAY_AGG(id)
  INTO   v_tx_ids
  FROM   public.transactions
  WHERE  school_id  = p_school_id
    AND  id        = ANY(v_req.paid_transaction_ids);

  -- ── 6. INSERT idempotente ─────────────────────────────────────────────────
  -- ON CONFLICT repite el predicado del índice parcial EXPLÍCITAMENTE.
  -- Si ya existe una fila con esta clave, el INSERT es silencioso (DO NOTHING).
  INSERT INTO public.billing_queue (
    recharge_request_id,
    student_id,
    school_id,
    amount,
    invoice_type,
    invoice_client_data,
    status,
    job_type,
    idempotency_key,
    emission_date,
    days_since_sale,
    transaction_ids
  )
  VALUES (
    p_recharge_request_id,
    v_student_id,
    p_school_id,
    COALESCE(v_req.amount, 0),
    CASE WHEN (v_req.invoice_client_data->>'ruc') IS NOT NULL
              AND length(trim(v_req.invoice_client_data->>'ruc')) = 11
         THEN 'factura'
         ELSE 'boleta'
    END,
    v_req.invoice_client_data,
    'pending',
    p_job_type,
    v_idem_key,
    v_emission_date,
    v_days_since_sale,
    v_tx_ids
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_new_id;

  -- ── 7. Si el INSERT fue silencioso (ya existía), devolver el ID existente ──
  IF v_new_id IS NULL THEN
    SELECT id INTO v_new_id
    FROM   public.billing_queue
    WHERE  idempotency_key = v_idem_key;

    RETURN jsonb_build_object(
      'status',   'already_enqueued',
      'queue_id', v_new_id,
      'detail',   'Job ya estaba en cola. No se creó duplicado.'
    );
  END IF;

  -- ── 8. Marcar transactions como 'queued' ──────────────────────────────────
  -- 'queued' = "encolada para facturar, SIN correlativo asignado".
  -- El correlativo se asigna SOLO en el momento de emitir (en el worker).
  IF v_tx_ids IS NOT NULL AND cardinality(v_tx_ids) > 0 THEN
    UPDATE public.transactions
    SET    billing_status = 'queued'
    WHERE  id        = ANY(v_tx_ids)
      AND  school_id = p_school_id
      AND  billing_status IN ('pending', 'failed');  -- no pisar 'sent' ni 'processing'
  END IF;

  RETURN jsonb_build_object(
    'status',        'enqueued',
    'queue_id',      v_new_id,
    'emission_date', v_emission_date,
    'days_elapsed',  v_days_since_sale
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_billing_emission(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_billing_emission(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.enqueue_billing_emission(uuid, uuid, text) IS
  'PORTÓN ÚNICO de entrada a billing_queue para el flujo asíncrono. '
  'Idempotente: ON CONFLICT DO NOTHING con índice parcial. '
  'Bloquea jobs extemporáneos (> 7 días) antes de encolar. '
  'Fase 1B: solo soporta job_type=voucher (recharge_request_id NOT NULL). '
  'POS / gateway_tx / daily_summary → Fase 2.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc
-- WHERE proname IN (
--   'enqueue_billing_emission',
--   'reserve_invoice_number_for_queue',
--   'get_lima_date_today',
--   'get_days_since_queue_sale'
-- );
-- ============================================================================
