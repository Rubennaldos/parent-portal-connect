-- ============================================================================
-- FASE 2A — PORTÓN EXTENDIDO: daily_summary · pos_sale · collection
-- Proyecto: Lima Café 28  ·  Fecha: 2026-06-22
-- ============================================================================
--
-- QUÉ HACE (en simple):
--   Extiende la cola de facturación para admitir 3 nuevos tipos de trabajo
--   que NUNCA tienen un voucher de recarga (recharge_request_id):
--
--     · daily_summary  → Boleta resumen diaria del Cierre Mensual.
--                        N transacciones de distinto alumno → 1 boleta colectiva.
--     · pos_sale       → Venta directa del kiosco con boleta/factura por ítem.
--                        Trae los ítems del carrito ya guardado en BD.
--     · collection     → Cobro de deuda confirmado en BillingCollection.
--                        Monto y txs verificados en BD; nunca se confía en el frontend.
--
-- CAMBIO AL ESQUEMA:
--   · billing_queue.student_id: NOT NULL → nullable.
--     Razón: daily_summary es un batch multi-alumno sin alumno "dueño".
--     La FK a students se conserva (si no-null, debe existir en la tabla).
--     Afecta SOLO las nuevas filas de estos job_types; las voucher-legacy siguen
--     teniendo student_id (los inserta el RPC v1 / process_traditional_voucher_approval).
--
--   · billing_queue.recharge_request_id ya es nullable (confirmado en auditoría).
--     No requiere cambio.
--
-- NUEVOS CHECKS:
--   · Coherencia por job_type: job_type='voucher' EXIGE recharge_request_id NOT NULL.
--   · job_type ampliado: agrega 'collection'.
--
-- NUEVOS OBJETOS:
--   · v_billing_masivo_emitible: vista con pending + queued para CierreMensual (Fase 2B).
--   · enqueue_billing_emission_v2: portón SSOT para los 3 nuevos job_types.
--
-- NO TOCA (Regla 0.A):
--   · Izipay, HMAC, logs_pasarela, apply_gateway_credit.
--   · enqueue_billing_emission v1 (flujo voucher intacto).
--   · process-billing-queue, generate-document (worker intacto).
--   · auto-billing cron y VoucherApproval (Fase 2C).
--   · v_billing_masivo_pending (el cron auto-invoice sigue usándola).
--
-- DEPENDE DE:
--   · 20260621_fase1a (columnas idempotency_key, job_type, transaction_ids,
--     payload_snapshot, emission_date, reserved_*, days_since_sale, invoice_id,
--     fatal_reason, estado 'queued' en transactions).
--   · 20260621_fase1b (function enqueue_billing_emission para vouchers).
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1: RELAJAR student_id EN billing_queue
-- ────────────────────────────────────────────────────────────────────────────
-- student_id sigue siendo una FK válida (si presente, el alumno debe existir),
-- pero ya no es obligatorio para los nuevos job_types batch/POS.
-- Filas legacy (voucher, izipay) siempre vienen con student_id; no cambia nada.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.billing_queue
  ALTER COLUMN student_id DROP NOT NULL;

COMMENT ON COLUMN public.billing_queue.student_id IS
  'FK al alumno propietario del comprobante. '
  'Obligatorio para job_type=voucher. NULL permitido para daily_summary (batch '
  'multi-alumno), pos_sale (kiosco sin alumno fijo) y collection (multi-deudor).';

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2: CHECK DE COHERENCIA POR job_type
-- ────────────────────────────────────────────────────────────────────────────
-- Garantía: si job_type='voucher', recharge_request_id DEBE ser NOT NULL.
-- Para todos los demás (o NULL legacy), no hay restricción.
-- Idempotente: DROP IF EXISTS + ADD.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.billing_queue
  DROP CONSTRAINT IF EXISTS chk_billing_queue_voucher_coherence;

ALTER TABLE public.billing_queue
  ADD  CONSTRAINT chk_billing_queue_voucher_coherence
  CHECK (
    -- Legacy rows (job_type NULL) y todos los nuevos job_types: sin restricción.
    job_type IS NULL
    OR job_type <> 'voucher'
    -- Vouchers SIEMPRE deben tener su recharge_request.
    OR (job_type = 'voucher' AND recharge_request_id IS NOT NULL)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3: AMPLIAR CHECK DE job_type (agrega 'collection')
-- ────────────────────────────────────────────────────────────────────────────
-- Técnica: buscar el CHECK actual por contenido ('job_type') y reemplazarlo.
-- Excluye chk_billing_queue_voucher_coherence (ya contiene 'job_type' como texto).
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM   pg_constraint
    WHERE  conrelid  = 'public.billing_queue'::regclass
      AND  contype   = 'c'
      AND  pg_get_constraintdef(oid) LIKE '%job_type%'
      AND  conname  <> 'chk_billing_queue_voucher_coherence'
  LOOP
    EXECUTE 'ALTER TABLE public.billing_queue DROP CONSTRAINT ' || quote_ident(v_con);
    RAISE NOTICE '[Fase 2A] CHECK job_type anterior eliminado: %', v_con;
  END LOOP;
END;
$$;

ALTER TABLE public.billing_queue
  ADD  CONSTRAINT chk_billing_queue_job_type
  CHECK (
    job_type IS NULL
    OR job_type IN (
      'voucher',
      'gateway_tx',
      'pos_sale',
      'daily_summary',
      'manual',
      'credit_note',
      'collection'       -- ← NUEVO (cobros directos de deuda via BillingCollection)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 4: VISTA v_billing_masivo_emitible
-- ────────────────────────────────────────────────────────────────────────────
-- Propósito Fase 2B: reemplazar v_billing_masivo_pending en CierreMensual.
-- Devuelve las mismas columnas + billing_status para que la UI muestre
-- badges distintos: "Pendiente" (pending) vs "En cola" (queued).
--
-- v_billing_masivo_pending QUEDA INTACTA para el cron auto-invoice.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_billing_masivo_emitible
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.school_id,
  t.created_at,
  t.payment_method,
  t.amount,
  t.billing_status,                                              -- EXTRA vs v_billing_masivo_pending

  -- Día en hora Lima (Regla #11.C: reloj único de PostgreSQL)
  (t.created_at AT TIME ZONE 'America/Lima')::date            AS dia_venta_lima,

  -- Monto boleteable (Regla #11.A: cálculo en BD, nunca en JS)
  -- Mixto: solo la parte digital (la dueña no boletea efectivo)
  CASE
    WHEN lower(btrim(t.payment_method)) = 'mixto'
    THEN round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2)
    ELSE round(abs(t.amount), 2)
  END                                                          AS monto_boleteable,

  -- Días desde la venta (para el badge "Extemporáneo")
  ( (now() AT TIME ZONE 'America/Lima')::date
    - (t.created_at AT TIME ZONE 'America/Lima')::date )       AS dias_desde_venta,

  -- Candado de fecha SUNAT (RS 097-2012: máximo 7 días)
  ( (now() AT TIME ZONE 'America/Lima')::date
    - (t.created_at AT TIME ZONE 'America/Lima')::date ) > 7   AS es_extemporaneo,

  t.metadata

FROM public.transactions t
WHERE
  t.is_taxable     = true
  AND t.billing_status IN ('pending', 'queued')               -- pending = sin encolar; queued = encolada
  AND t.document_type  = 'ticket'
  AND t.payment_status = 'paid'
  AND COALESCE(t.is_deleted, false) = false
  AND t.amount <> 0
  -- Métodos digitales (los mismos de v_billing_masivo_pending, case-insensitive)
  AND lower(btrim(t.payment_method)) IN (
    'yape', 'yape_qr', 'yape_numero',
    'plin', 'plin_qr', 'plin_numero',
    'transferencia', 'transfer',
    'tarjeta', 'card',
    'mixto'
  )
  -- Excluir almuerzos anulados (paridad con v_billing_masivo_pending)
  AND NOT EXISTS (
    SELECT 1
    FROM   public.lunch_orders lo
    WHERE  lo.id::text = (t.metadata->>'lunch_order_id')
      AND  (lo.status = 'cancelled' OR lo.is_cancelled = true)
  )
  -- Mixto con parte digital = 0: nada que boletear
  AND (
    lower(btrim(t.payment_method)) <> 'mixto'
    OR round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2) > 0
  );

COMMENT ON VIEW public.v_billing_masivo_emitible IS
  'v2 de v_billing_masivo_pending para CierreMensual (Fase 2B). '
  'Incluye billing_status IN (pending, queued): '
  'pending = sin encolar todavía; queued = encolada esperando al worker. '
  'La columna billing_status permite mostrar badges distintos en la UI. '
  'v_billing_masivo_pending queda intacta para el cron auto-invoice.';

GRANT SELECT ON public.v_billing_masivo_emitible TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- BLOQUE 5: enqueue_billing_emission_v2
-- ────────────────────────────────────────────────────────────────────────────
-- Portón ÚNICO para los 3 nuevos flujos de facturación asíncrona.
--
-- GARANTÍAS (por diseño, no por documentación):
--   · Total calculado en BD — nunca se acepta un monto del frontend.
--   · IGV en aritmética de enteros (céntimos) con ajuste de residuo.
--   · payload_snapshot construido 100% en SQL → el worker lo usa tal cual.
--   · Idempotente: ON CONFLICT DO NOTHING con índice parcial.
--   · Marca transactions como 'queued' en el mismo COMMIT.
--   · Bloqueo extemporáneo > 7 días (misma regla que enqueue_billing_emission v1).
--
-- PARÁMETROS:
--   p_job_type             → 'daily_summary' | 'pos_sale' | 'collection'
--   p_school_id            → UUID de la sede (siempre obligatorio)
--   p_transaction_ids      → Para daily_summary y collection (array de IDs)
--   p_transaction_id       → Para pos_sale (ID único de la transacción)
--   p_invoice_client_data  → JSONB con doc_type/doc_number/razon_social/direccion/email
--   p_invoice_type         → 'boleta' | 'factura' (default 'boleta')
--   p_payment_method       → Método de pago para el payload
--   p_description          → Descripción de la línea del comprobante
--   p_items_raw            → Ítems del carrito POS: [{name,qty,unit_price[,uom,code]}]
--   p_emission_date        → Fecha de emisión (default: hoy Lima; retrofechar máx 7 días)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enqueue_billing_emission_v2(
  p_job_type            text,
  p_school_id           uuid,
  p_transaction_ids     uuid[]   DEFAULT NULL,
  p_transaction_id      uuid     DEFAULT NULL,
  p_invoice_client_data jsonb    DEFAULT NULL,
  p_invoice_type        text     DEFAULT NULL,
  p_payment_method      text     DEFAULT NULL,
  p_description         text     DEFAULT NULL,
  p_items_raw           jsonb    DEFAULT NULL,
  p_emission_date       date     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Aritmética IGV (Regla #11.A: cero cálculos en cliente)
  v_igv_pct          numeric;
  v_divisor_x100     numeric;
  v_total            numeric;
  v_total_cents      bigint;
  v_base_cents       bigint;
  v_igv_cents        bigint;
  v_base             numeric;
  v_igv              numeric;

  -- Datos del comprobante
  v_invoice_type     text;
  v_tipo             int;
  v_client_data      jsonb;
  v_items            jsonb;
  v_payload          jsonb;

  -- Control de cola
  v_idem_key         text;
  v_new_id           uuid;
  v_tx_ids           uuid[];
  v_student_id       uuid;
  v_emission_date    date;
  v_days_elapsed     int;

  -- Validación de ítems POS
  v_items_sum        numeric;
BEGIN

  -- ── 0. VALIDACIONES BASE ───────────────────────────────────────────────────
  IF p_job_type NOT IN ('daily_summary', 'pos_sale', 'collection') THEN
    RETURN jsonb_build_object(
      'error',    'INVALID_JOB_TYPE_V2',
      'detail',   'enqueue_billing_emission_v2 acepta: daily_summary | pos_sale | collection. '
                  'Para job_type=voucher usar enqueue_billing_emission (v1).',
      'received', p_job_type
    );
  END IF;

  IF p_school_id IS NULL THEN
    RETURN jsonb_build_object(
      'error',  'SCHOOL_ID_REQUIRED',
      'detail', 'p_school_id es obligatorio.'
    );
  END IF;

  -- ── 1. IGV DESDE billing_config (Regla #11.A: BD dicta, nunca el frontend) ─
  SELECT COALESCE(bc.igv_porcentaje, 18)
  INTO   v_igv_pct
  FROM   public.billing_config bc
  WHERE  bc.school_id = p_school_id
    AND  bc.activo    = true
  LIMIT  1;

  v_igv_pct      := COALESCE(v_igv_pct, 18);
  v_divisor_x100 := 100 + v_igv_pct;

  -- ── 2. FECHA LIMA (Regla #11.C: reloj único de PostgreSQL, nunca new Date()) ─
  v_emission_date := COALESCE(p_emission_date, timezone('America/Lima', now())::date);
  v_days_elapsed  := GREATEST(0, (timezone('America/Lima', now())::date - v_emission_date));

  -- ── 3. BLOQUEO EXTEMPORÁNEO (mismo criterio que enqueue_billing_emission v1) ─
  -- SUNAT rechaza documentos con más de 7 días de antigüedad (RS 097-2012).
  IF v_days_elapsed > 7 THEN
    RETURN jsonb_build_object(
      'error',       'EXTEMPORANEO',
      'detail',      'La fecha de emisión tiene ' || v_days_elapsed || ' días. '
                     'SUNAT solo acepta documentos de hasta 7 días. '
                     'Coordinar con la contadora para gestión manual.',
      'days_elapsed', v_days_elapsed,
      'emission_date', v_emission_date
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- 4. DISPATCH POR job_type
  -- ══════════════════════════════════════════════════════════════════════

  -- ──────────────────────────────────────────────────────────────────────
  -- A. daily_summary — Boleta resumen diaria (Cierre Mensual)
  -- Batch de N transacciones → 1 boleta "Consumidor Final".
  -- El total se calcula con la misma fórmula que v_billing_masivo_pending.
  -- ──────────────────────────────────────────────────────────────────────
  IF p_job_type = 'daily_summary' THEN

    IF p_transaction_ids IS NULL OR cardinality(p_transaction_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_IDS_REQUIRED',
        'detail', 'daily_summary requiere p_transaction_ids con al menos 1 ID.'
      );
    END IF;

    -- Solo los IDs que pertenecen a la sede y son emitibles (is_taxable, no borradas)
    SELECT ARRAY_AGG(t.id ORDER BY t.id)
    INTO   v_tx_ids
    FROM   public.transactions t
    WHERE  t.id         = ANY(p_transaction_ids)
      AND  t.school_id  = p_school_id
      AND  t.is_taxable = true
      AND  COALESCE(t.is_deleted, false) = false;

    IF v_tx_ids IS NULL OR cardinality(v_tx_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'NO_TAXABLE_TRANSACTIONS',
        'detail', 'Ninguna ID enviada es una transacción emitible en esta sede. '
                  'Verificar is_taxable=true y school_id correcto.'
      );
    END IF;

    -- Total boleteable en SQL — misma fórmula que v_billing_masivo_pending
    -- Mixto: solo la parte no-efectivo (regla de la dueña: efectivo ≠ SUNAT)
    SELECT COALESCE(SUM(
      CASE
        WHEN lower(btrim(t.payment_method)) = 'mixto'
        THEN round(abs(t.amount) - COALESCE(t.cash_amount, 0), 2)
        ELSE round(abs(t.amount), 2)
      END
    ), 0)
    INTO  v_total
    FROM  public.transactions t
    WHERE t.id        = ANY(v_tx_ids)
      AND t.school_id = p_school_id;

    IF v_total <= 0 THEN
      RETURN jsonb_build_object(
        'error',  'ZERO_AMOUNT',
        'detail', 'El total boleteable calculado es 0. Verificar montos de las transacciones.'
      );
    END IF;

    -- Clave de idempotencia: hash determinístico por sede + IDs ordenadas
    v_idem_key := md5(
      'daily_summary|' || p_school_id::text || '|' ||
      array_to_string(v_tx_ids, ',')        -- ya ordenados (ORDER BY t.id arriba)
    );

    -- IGV en enteros (Regla #11.A: aritmética de céntimos, sin fugas IEEE 754)
    v_total_cents := round(v_total * 100)::bigint;
    v_base_cents  := floor(v_total_cents * 100.0 / v_divisor_x100)::bigint;
    v_igv_cents   := v_total_cents - v_base_cents;
    v_base        := v_base_cents::numeric / 100;
    v_igv         := v_igv_cents::numeric / 100;

    -- payload_snapshot: estructura exacta que espera generate-document
    v_payload := jsonb_build_object(
      'school_id',     p_school_id,
      'tipo',          2,                          -- 2 = boleta
      'emission_date', v_emission_date::text,
      'cliente',       jsonb_build_object(
        'doc_type',    '-',
        'doc_number',  '-',
        'razon_social','Consumidor Final',
        'direccion',   '-'
      ),
      'items', jsonb_build_array(jsonb_build_object(
        'unidad_de_medida',        'NIU',
        'codigo',                  'RVD',
        'descripcion',             COALESCE(
          p_description,
          'Resumen Ventas Diarias ' || to_char(v_emission_date, 'DD/MM/YYYY')
        ),
        'cantidad',                1,
        'valor_unitario',          v_base,
        'precio_unitario',         v_total,
        'descuento',               '',
        'subtotal',                v_base,
        'tipo_de_igv',             1,
        'igv',                     v_igv,
        'total',                   v_total,
        'anticipo_regularizacion', false
      )),
      'monto_total',   v_total,
      'payment_method','digital'
    );

    v_invoice_type := 'boleta';
    v_student_id   := NULL;       -- batch multi-alumno: no hay alumno único

  -- ──────────────────────────────────────────────────────────────────────
  -- B. collection — Cobro de deuda confirmado (BillingCollection)
  -- El monto SIEMPRE viene de la suma de las transacciones en BD.
  -- El frontend no puede inflar ni deflactar el total.
  -- ──────────────────────────────────────────────────────────────────────
  ELSIF p_job_type = 'collection' THEN

    IF p_transaction_ids IS NULL OR cardinality(p_transaction_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_IDS_REQUIRED',
        'detail', 'collection requiere p_transaction_ids.'
      );
    END IF;

    IF p_invoice_client_data IS NULL THEN
      RETURN jsonb_build_object(
        'error',  'INVOICE_CLIENT_DATA_REQUIRED',
        'detail', 'collection requiere p_invoice_client_data con los datos del contribuyente.'
      );
    END IF;

    -- Tipo de comprobante
    v_invoice_type := lower(trim(COALESCE(p_invoice_type, 'boleta')));
    IF v_invoice_type NOT IN ('boleta', 'factura') THEN
      RETURN jsonb_build_object(
        'error',    'INVALID_INVOICE_TYPE',
        'detail',   'p_invoice_type debe ser ''boleta'' o ''factura''.',
        'received', v_invoice_type
      );
    END IF;
    v_tipo := CASE WHEN v_invoice_type = 'factura' THEN 1 ELSE 2 END;

    -- Total DESDE LA BD (Regla #1: SSOT financiero — nunca del frontend)
    SELECT ARRAY_AGG(t.id ORDER BY t.id),
           COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_tx_ids,
           v_total
    FROM   public.transactions t
    WHERE  t.id             = ANY(p_transaction_ids)
      AND  t.school_id      = p_school_id
      AND  t.payment_status = 'paid'
      AND  COALESCE(t.is_deleted, false) = false;

    IF v_tx_ids IS NULL OR cardinality(v_tx_ids) = 0 THEN
      RETURN jsonb_build_object(
        'error',  'NO_PAID_TRANSACTIONS',
        'detail', 'No se encontraron transacciones pagadas para esas IDs en esta sede. '
                  'Verificar payment_status=paid y school_id.'
      );
    END IF;

    IF v_total <= 0 THEN
      RETURN jsonb_build_object(
        'error',  'ZERO_AMOUNT',
        'detail', 'El total calculado desde las transacciones es 0.'
      );
    END IF;

    -- student_id de la primera transacción (referencia para auditoría)
    SELECT t.student_id INTO v_student_id
    FROM   public.transactions t
    WHERE  t.id = v_tx_ids[1]
    LIMIT  1;

    -- Clave de idempotencia: hash de IDs ordenadas (misma llamada = mismo resultado)
    v_idem_key := md5('collection|' || array_to_string(v_tx_ids, ','));

    -- IGV en enteros
    v_total_cents := round(v_total * 100)::bigint;
    v_base_cents  := floor(v_total_cents * 100.0 / v_divisor_x100)::bigint;
    v_igv_cents   := v_total_cents - v_base_cents;
    v_base        := v_base_cents::numeric / 100;
    v_igv         := v_igv_cents::numeric / 100;

    -- Normalizar cliente (COALESCE defensivo: evita que un campo null rompa Nubefact)
    v_client_data := jsonb_build_object(
      'doc_type',    COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_type'),    ''), '-'),
      'doc_number',  COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_number'),  ''), '-'),
      'razon_social',COALESCE(NULLIF(trim(p_invoice_client_data->>'razon_social'),''), 'Consumidor Final'),
      'direccion',   COALESCE(NULLIF(trim(p_invoice_client_data->>'direccion'),   ''), '-'),
      'email',       COALESCE(NULLIF(trim(p_invoice_client_data->>'email'),       ''), '')
    );

    v_payload := jsonb_build_object(
      'school_id',     p_school_id,
      'tipo',          v_tipo,
      'cliente',       v_client_data,
      'items', jsonb_build_array(jsonb_build_object(
        'unidad_de_medida',        'NIU',
        'codigo',                  'COBRO',
        'descripcion',             COALESCE(p_description, 'Cobro deuda'),
        'cantidad',                1,
        'valor_unitario',          v_base,
        'precio_unitario',         v_total,
        'descuento',               '',
        'subtotal',                v_base,
        'tipo_de_igv',             1,
        'igv',                     v_igv,
        'total',                   v_total,
        'anticipo_regularizacion', false
      )),
      'monto_total',   v_total,
      'payment_method', COALESCE(p_payment_method, 'efectivo')
    );

  -- ──────────────────────────────────────────────────────────────────────
  -- C. pos_sale — Venta directa del kiosco
  -- El total SIEMPRE viene del campo amount de la transacción en BD.
  -- Si se pasan ítems (p_items_raw), el IGV se recalcula en SQL por cada
  -- ítem usando aritmética de enteros con ajuste de residuo en el último.
  -- Sin ítems: una sola línea de resumen (boletas sin DNI).
  -- ──────────────────────────────────────────────────────────────────────
  ELSIF p_job_type = 'pos_sale' THEN

    IF p_transaction_id IS NULL THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_ID_REQUIRED',
        'detail', 'pos_sale requiere p_transaction_id (UUID de la transacción ya guardada en BD).'
      );
    END IF;

    -- Tipo de comprobante
    v_invoice_type := lower(trim(COALESCE(p_invoice_type, 'boleta')));
    IF v_invoice_type NOT IN ('boleta', 'factura') THEN
      RETURN jsonb_build_object(
        'error',    'INVALID_INVOICE_TYPE',
        'detail',   'p_invoice_type debe ser ''boleta'' o ''factura''.',
        'received', v_invoice_type
      );
    END IF;
    v_tipo := CASE WHEN v_invoice_type = 'factura' THEN 1 ELSE 2 END;

    -- Monto DESDE LA BD — NUNCA del frontend (Regla #1 SSOT financiero)
    SELECT ABS(t.amount), t.student_id
    INTO   v_total,       v_student_id
    FROM   public.transactions t
    WHERE  t.id        = p_transaction_id
      AND  t.school_id = p_school_id
      AND  COALESCE(t.is_deleted, false) = false;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'error',  'TRANSACTION_NOT_FOUND',
        'detail', 'Transacción no encontrada o no pertenece a esta sede.',
        'tx_id',  p_transaction_id
      );
    END IF;

    IF v_total <= 0 THEN
      RETURN jsonb_build_object(
        'error',  'ZERO_AMOUNT',
        'detail', 'La transacción tiene monto 0 o negativo.'
      );
    END IF;

    v_tx_ids   := ARRAY[p_transaction_id];
    v_idem_key := md5('pos_sale|' || p_transaction_id::text);

    -- IGV del header en enteros
    v_total_cents := round(v_total * 100)::bigint;
    v_base_cents  := floor(v_total_cents * 100.0 / v_divisor_x100)::bigint;
    v_igv_cents   := v_total_cents - v_base_cents;
    v_base        := v_base_cents::numeric / 100;
    v_igv         := v_igv_cents::numeric / 100;

    -- Cliente (NULL → Consumidor Final, válido para boleta sin DNI)
    IF p_invoice_client_data IS NOT NULL THEN
      v_client_data := jsonb_build_object(
        'doc_type',    COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_type'),    ''), '-'),
        'doc_number',  COALESCE(NULLIF(trim(p_invoice_client_data->>'doc_number'),  ''), '-'),
        'razon_social',COALESCE(NULLIF(trim(p_invoice_client_data->>'razon_social'),''), 'Consumidor Final'),
        'direccion',   COALESCE(NULLIF(trim(p_invoice_client_data->>'direccion'),   ''), '-'),
        'email',       COALESCE(NULLIF(trim(p_invoice_client_data->>'email'),       ''), '')
      );
    ELSE
      v_client_data := jsonb_build_object(
        'doc_type',    '-',
        'doc_number',  '-',
        'razon_social','Consumidor Final',
        'direccion',   '-'
      );
    END IF;

    -- ── Construir ítems ────────────────────────────────────────────────
    IF p_items_raw IS NOT NULL AND jsonb_array_length(p_items_raw) > 0 THEN

      -- Validar que la suma de ítems coincide con el total de la transacción en BD
      -- (tolerancia de ±0.02 por redondeo IEEE 754 al acumular precios unitarios)
      SELECT COALESCE(SUM(
        round((elem->>'unit_price')::numeric * (elem->>'qty')::numeric, 2)
      ), 0)
      INTO   v_items_sum
      FROM   jsonb_array_elements(p_items_raw) AS elem;

      IF ABS(v_items_sum - v_total) > 0.02 THEN
        RETURN jsonb_build_object(
          'error',      'ITEMS_TOTAL_MISMATCH',
          'detail',     'La suma de ítems no coincide con el total de la transacción en BD. '
                        'El monto de referencia es el de la BD, no el del frontend.',
          'items_sum',  v_items_sum,
          'tx_total',   v_total
        );
      END IF;

      -- Calcular IGV por ítem con técnica "último ítem absorbe el residuo de redondeo"
      -- Regla #11.A: aritmética financiera ejecutada en SQL, nunca en React.
      --
      -- Lógica:
      --   1. Por cada ítem: raw_base = floor(item_cents * 100 / divisor_x100)
      --   2. residuo_base = v_base_cents - SUM(raw_base)  (0 ó ±1 céntimo)
      --   3. El ÚLTIMO ítem recibe el residuo → sum(adj_base) = v_base_cents (header)
      --   4. Igual para IGV.
      --
      -- IMPORTANTE: window functions NO pueden ir dentro de jsonb_agg (PostgreSQL
      -- prohíbe window functions dentro de funciones de agregación).
      -- Solución: pre-computar adj_base y adj_igv en un subquery intermedio (nivel 2),
      -- y usar esos valores calculados en el jsonb_agg exterior (nivel 3).
      SELECT jsonb_agg(
        jsonb_build_object(
          'unidad_de_medida',        COALESCE(NULLIF(trim(lv2.elem->>'uom'),  ''), 'NIU'),
          'codigo',                  COALESCE(NULLIF(trim(lv2.elem->>'code'), ''), LPAD(lv2.rn::text, 3, '0')),
          'descripcion',             COALESCE(NULLIF(trim(lv2.elem->>'name'), ''), 'Producto'),
          'cantidad',                (lv2.elem->>'qty')::numeric,
          -- valor_unitario = base por unidad (ya con ajuste de residuo)
          'valor_unitario',          round(lv2.adj_base::numeric / 100 / (lv2.elem->>'qty')::numeric, 6),
          'precio_unitario',         round((lv2.elem->>'unit_price')::numeric, 2),
          'descuento',               '',
          'subtotal',                round(lv2.adj_base::numeric / 100, 2),
          'tipo_de_igv',             1,
          'igv',                     round(lv2.adj_igv::numeric / 100, 2),
          'total',                   round(lv2.item_cents::numeric / 100, 2),
          'anticipo_regularizacion', false
        )
        ORDER BY lv2.rn
      )
      INTO  v_items
      FROM (
        -- Nivel 2: aplicar residuo al último ítem.
        -- Window functions válidas aquí (no dentro de jsonb_agg).
        SELECT
          lv1.elem,
          lv1.item_cents,
          lv1.rn,
          -- base con residuo: garantiza SUM(adj_base) = v_base_cents (header)
          floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint
            + CASE WHEN lv1.rn = lv1.cnt
                   THEN v_base_cents
                        - SUM(floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint) OVER ()
                   ELSE 0
              END   AS adj_base,
          -- igv con residuo: garantiza SUM(adj_igv) = v_igv_cents (header)
          (lv1.item_cents - floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint)
            + CASE WHEN lv1.rn = lv1.cnt
                   THEN v_igv_cents
                        - SUM(lv1.item_cents
                              - floor(lv1.item_cents * 100.0 / v_divisor_x100)::bigint) OVER ()
                   ELSE 0
              END   AS adj_igv
        FROM (
          -- Nivel 1: calcular item_cents y posición de cada fila
          SELECT
            elem,
            round((elem->>'unit_price')::numeric * (elem->>'qty')::numeric * 100)::bigint AS item_cents,
            row_number() OVER () AS rn,
            count(*)     OVER () AS cnt
          FROM jsonb_array_elements(p_items_raw) AS elem
        ) lv1
      ) lv2;

    ELSE
      -- Sin ítems detallados: línea única de resumen (boleta sin DNI / ticket rápido)
      v_items := jsonb_build_array(jsonb_build_object(
        'unidad_de_medida',        'NIU',
        'codigo',                  'VTA',
        'descripcion',             COALESCE(p_description, 'Venta kiosco'),
        'cantidad',                1,
        'valor_unitario',          v_base,
        'precio_unitario',         v_total,
        'descuento',               '',
        'subtotal',                v_base,
        'tipo_de_igv',             1,
        'igv',                     v_igv,
        'total',                   v_total,
        'anticipo_regularizacion', false
      ));
    END IF;

    v_payload := jsonb_build_object(
      'school_id',      p_school_id,
      'transaction_id', p_transaction_id,
      'tipo',           v_tipo,
      'cliente',        v_client_data,
      'items',          v_items,
      'monto_total',    v_total,
      'payment_method', COALESCE(p_payment_method, 'digital')
    );

  END IF;  -- fin DISPATCH

  -- ── 5. INSERT IDEMPOTENTE ─────────────────────────────────────────────────
  -- ON CONFLICT DO NOTHING con el índice parcial uq_billing_queue_idempotency_key
  -- (creado en Fase 1A). Segunda llamada idéntica: silenciosa, devuelve el ID existente.
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
    transaction_ids,
    payload_snapshot
  )
  VALUES (
    NULL,                                    -- sin voucher de recarga
    v_student_id,                            -- puede ser NULL (daily_summary)
    p_school_id,
    v_total,
    v_invoice_type,
    COALESCE(p_invoice_client_data, NULL),   -- nullable en la tabla
    'pending',
    p_job_type,
    v_idem_key,
    v_emission_date,
    v_days_elapsed,
    v_tx_ids,
    v_payload
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_new_id;

  -- ── 6. RESPONDER SI YA EXISTÍA ────────────────────────────────────────────
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

  -- ── 7. MARCAR TRANSACTIONS COMO 'queued' ─────────────────────────────────
  -- 'queued' = encolada para facturar, SIN correlativo asignado todavía.
  -- El correlativo lo asigna SOLO el worker (fn_reserve_invoice_number_for_queue).
  -- Solo transiciones válidas: pending → queued, failed → queued.
  -- No se pisa 'sent', 'processing', ni 'excluded'.
  IF v_tx_ids IS NOT NULL AND cardinality(v_tx_ids) > 0 THEN
    UPDATE public.transactions
    SET    billing_status = 'queued'
    WHERE  id        = ANY(v_tx_ids)
      AND  school_id = p_school_id
      AND  billing_status IN ('pending', 'failed');
  END IF;

  RETURN jsonb_build_object(
    'status',        'enqueued',
    'queue_id',      v_new_id,
    'emission_date', v_emission_date,
    'days_elapsed',  v_days_elapsed,
    'tx_count',      COALESCE(cardinality(v_tx_ids), 0),
    'total',         v_total,
    'job_type',      p_job_type
  );

EXCEPTION WHEN OTHERS THEN
  -- NUNCA silenciar errores de BD: devolver el mensaje técnico para diagnóstico.
  -- El frontend debe mostrar fnData?.error antes que fnError?.message (Regla SSOT).
  RETURN jsonb_build_object(
    'error',  'UNEXPECTED_ERROR',
    'detail', SQLERRM,
    'hint',   'Revisar logs de Supabase Dashboard → Edge Function o Postgres logs.'
  );
END;
$$;

-- GRANTS
GRANT EXECUTE ON FUNCTION public.enqueue_billing_emission_v2(
  text, uuid, uuid[], uuid, jsonb, text, text, text, jsonb, date
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_billing_emission_v2(
  text, uuid, uuid[], uuid, jsonb, text, text, text, jsonb, date
) TO service_role;

COMMENT ON FUNCTION public.enqueue_billing_emission_v2(
  text, uuid, uuid[], uuid, jsonb, text, text, text, jsonb, date
) IS
  'PORTÓN v2 de billing_queue. Soporta job_type: daily_summary (Cierre Mensual), '
  'pos_sale (kiosco), collection (cobranzas directas). '
  'Para voucher usar enqueue_billing_emission v1. '
  'Garantías: total calculado en BD (SSOT), IGV en enteros, payload_snapshot '
  'construido 100% en SQL, idempotente (ON CONFLICT DO NOTHING), '
  'marca transactions como queued en el mismo commit.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (solo SELECT — no cambia nada, ejecutar después de aplicar)
-- ============================================================================

-- 1) Confirmar que student_id es ahora nullable en billing_queue:
-- SELECT column_name, is_nullable
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public'
--   AND  table_name   = 'billing_queue'
--   AND  column_name  IN ('student_id', 'recharge_request_id');
-- ESPERA: ambas filas con is_nullable = 'YES'

-- 2) Confirmar nuevo CHECK de job_type incluye 'collection':
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM   pg_constraint
-- WHERE  conrelid = 'public.billing_queue'::regclass
--   AND  contype  = 'c'
-- ORDER BY conname;

-- 3) Confirmar función creada:
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM   pg_proc
-- WHERE  proname = 'enqueue_billing_emission_v2';

-- 4) Confirmar vista creada:
-- SELECT viewname FROM pg_views
-- WHERE  schemaname = 'public'
--   AND  viewname   = 'v_billing_masivo_emitible';

-- 5) Test de llamada (reemplazar con IDs reales):
-- SELECT public.enqueue_billing_emission_v2(
--   'daily_summary',
--   '<SCHOOL_ID>',
--   ARRAY['<TX_ID_1>', '<TX_ID_2>']::uuid[]
-- );
-- ESPERA: {"status":"enqueued","queue_id":"...","tx_count":2,...}

-- 6) Test idempotencia (misma llamada dos veces):
-- SELECT public.enqueue_billing_emission_v2( ... );  -- debe devolver "already_enqueued"

-- 7) Verificar que v_billing_masivo_pending NO cambió (cron sigue funcionando):
-- SELECT count(*) FROM v_billing_masivo_pending WHERE school_id = '<SCHOOL_ID>';
-- ============================================================================
