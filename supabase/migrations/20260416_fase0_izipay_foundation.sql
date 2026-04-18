-- ══════════════════════════════════════════════════════════════════════════════
-- FASE 0 — Cimentación para Integración de Pasarelas (IziPay)
-- Fecha    : 2026-04-16
-- Autor    : Sistema (migración generada por Cursor AI)
-- Propósito: Preparar la infraestructura de base de datos para procesar pagos
--            de pasarelas externas de forma segura, atómica e idempotente.
--
-- OBJETOS CREADOS:
--   1. TYPE  gateway_payment_status          — máquina de estados unificada
--   2. TABLE gateway_webhook_events          — escudo anti-duplicación (idempotencia)
--   3. COL   transactions.payment_session_id — FK hacia la sesión de pago
--   4. COL   transactions.gateway_reference_id    — orderId en IziPay
--   5. COL   transactions.gateway_transaction_id  — transactionUuid en IziPay
--   6. COL   payment_sessions.gateway_status — estado dentro de la máquina de estados
--   7. FUNC  apply_gateway_credit            — caja fuerte contable (RPC canónico)
--   8. IDX   varios                          — búsqueda instantánea por referencia
--
-- RETROCOMPATIBILIDAD:
--   - Todas las columnas nuevas son NULL-able → cero impacto en filas existentes.
--   - No se renombra ni elimina ninguna columna existente.
--   - payment_sessions.status (text) sigue siendo el campo legacy.
--   - gateway_status es el nuevo campo tipado; se rellena desde 'status' en este script.
--   - El trigger trg_log_student_balance_change (ya existente) sigue auditando
--     cualquier cambio en students.balance, incluyendo los nuevos créditos de gateway.
-- ══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 1: MÁQUINA DE ESTADOS — TYPE gateway_payment_status
-- ═══════════════════════════════════════════════════════════════════════════
-- Estados:
--   pending    → sesión creada, esperando acción del padre en la pasarela
--   processing → la pasarela recibió el pago, pendiente de confirmación final
--   success    → pago confirmado — se debe ejecutar apply_gateway_credit
--   failed     → pago rechazado por el banco o la pasarela
--   expired    → ventana de pago venció (30 min en IziPay)
--   refunded   → pago devuelto (uso futuro)
-- SEPARACIÓN DE RESPONSABILIDADES:
--   gateway_payment_status → estado del COBRO (¿llegó el dinero?)
--   billing_status         → estado FISCAL (¿se emitió boleta en SUNAT?)
--   payment_status         → estado CONTABLE interno (¿se saldó la deuda?)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  CREATE TYPE public.gateway_payment_status AS ENUM (
    'pending',
    'processing',
    'success',
    'failed',
    'expired',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'TYPE gateway_payment_status ya existe — saltando creación.';
END
$$;

COMMENT ON TYPE public.gateway_payment_status IS
  'Estado de pago en pasarela externa (IziPay, Niubiz, Culqi). '
  'INDEPENDIENTE de billing_status (SUNAT) y de payment_status (contable interno).';


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 2: TABLA gateway_webhook_events (Escudo de Idempotencia)
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLEMA QUE RESUELVE:
--   IziPay puede enviar el mismo webhook N veces (reintentos, red inestable).
--   Sin esta tabla, cada reintento duplicaría el saldo del alumno.
--
-- FLUJO DE USO:
--   1. Webhook llega → intentar INSERT en esta tabla.
--   2. Si (provider_name, external_event_id) ya existe → retornar 200 OK sin procesar.
--   3. Si es nuevo → procesar (apply_gateway_credit) → SET processed_at = NOW().
--   4. Si el procesamiento falla → processed_at queda NULL, processing_error se llena.
--      El siguiente reintento del webhook puede reprocesarlo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gateway_webhook_events (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificación del evento
  provider_name      TEXT         NOT NULL
                                  CHECK (provider_name IN ('izipay','niubiz','culqi','mercadopago','stripe')),
  external_event_id  TEXT         NOT NULL,   -- orderId de IziPay (el identificador único del evento)

  -- Datos del evento
  payload            JSONB        NOT NULL DEFAULT '{}',
  gateway_status     public.gateway_payment_status NOT NULL DEFAULT 'pending',

  -- Estado de procesamiento
  processed_at       TIMESTAMPTZ,             -- NULL = aún no procesado / procesamiento fallido
  processing_error   TEXT,                    -- mensaje de error si falló

  -- Trazabilidad
  payment_session_id UUID         REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
  school_id          UUID,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Índice ÚNICO: el corazón de la idempotencia.
-- (provider_name, external_event_id) identifica de forma global un evento de pago.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gwhe_provider_event
  ON public.gateway_webhook_events (provider_name, external_event_id);

-- Índice para monitoreo de eventos sin procesar (dashboard admin)
CREATE INDEX IF NOT EXISTS idx_gwhe_unprocessed
  ON public.gateway_webhook_events (created_at)
  WHERE processed_at IS NULL;

-- Índice para enlazar con la sesión de pago
CREATE INDEX IF NOT EXISTS idx_gwhe_session
  ON public.gateway_webhook_events (payment_session_id)
  WHERE payment_session_id IS NOT NULL;

-- RLS: solo service_role puede escribir; authenticated no tiene acceso
ALTER TABLE public.gateway_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_gwhe" ON public.gateway_webhook_events;
CREATE POLICY "service_role_full_access_gwhe"
  ON public.gateway_webhook_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "no_public_access_gwhe" ON public.gateway_webhook_events;
CREATE POLICY "no_public_access_gwhe"
  ON public.gateway_webhook_events FOR SELECT
  TO authenticated
  USING (false);

COMMENT ON TABLE public.gateway_webhook_events IS
  'Registro de todos los eventos webhook recibidos de pasarelas externas. '
  'El índice único (provider_name, external_event_id) garantiza idempotencia: '
  'el mismo aviso de pago no puede procesarse dos veces aunque IziPay lo reenvíe.';


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 3: TRAZABILIDAD EN TABLA transactions
-- ═══════════════════════════════════════════════════════════════════════════
-- Se añaden 3 columnas NULL-able (cero impacto en registros históricos):
--   payment_session_id    → FK hacia la sesión que originó esta transacción
--   gateway_reference_id  → orderId de IziPay (el código que manda el banco)
--   gateway_transaction_id → transactionUuid de IziPay (ID interno del banco)
--
-- Con estas columnas, para buscar "¿qué pasó con el pago IZP-XXXXX?"
-- solo se hace: SELECT * FROM transactions WHERE gateway_reference_id = 'IZP-XXXXX'
-- Tiempo de respuesta: < 1ms gracias a los índices.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_session_id      UUID  REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gateway_reference_id    TEXT,
  ADD COLUMN IF NOT EXISTS gateway_transaction_id  TEXT;

-- Índice de búsqueda por orderId de IziPay
CREATE INDEX IF NOT EXISTS idx_tx_gateway_ref
  ON public.transactions (gateway_reference_id)
  WHERE gateway_reference_id IS NOT NULL;

-- Índice de búsqueda por transactionUuid (ID del banco)
CREATE INDEX IF NOT EXISTS idx_tx_gateway_tx_id
  ON public.transactions (gateway_transaction_id)
  WHERE gateway_transaction_id IS NOT NULL;

-- Índice FK para joins con payment_sessions
CREATE INDEX IF NOT EXISTS idx_tx_payment_session_fk
  ON public.transactions (payment_session_id)
  WHERE payment_session_id IS NOT NULL;

-- Guardia de unicidad: un mismo pago de pasarela no puede generar 2 transacciones contables
-- Aplica SOLO a transacciones no eliminadas (is_deleted = false)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_gateway_ref_unique
  ON public.transactions (gateway_reference_id)
  WHERE gateway_reference_id IS NOT NULL
    AND is_deleted = false;

COMMENT ON COLUMN public.transactions.payment_session_id IS
  'FK opcional hacia payment_sessions. Presente cuando la transacción fue creada '
  'como resultado de un pago online (IziPay, Niubiz, etc.).';

COMMENT ON COLUMN public.transactions.gateway_reference_id IS
  'orderId enviado por la pasarela (IziPay: campo kr-answer.orderDetails.orderId). '
  'Índice único: no puede existir dos transacciones para el mismo orderId activo.';

COMMENT ON COLUMN public.transactions.gateway_transaction_id IS
  'transactionUuid devuelto por el banco vía la pasarela (IziPay: uuid en kr-answer). '
  'Referencia al movimiento bancario real.';


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 4: payment_sessions — campo gateway_status tipado
-- ═══════════════════════════════════════════════════════════════════════════
-- La columna 'status' (text) sigue existiendo para compatibilidad con el código
-- frontend y los RPCs existentes (submit_voucher_with_split, etc.).
-- La columna 'gateway_status' es el nuevo campo con tipo fuerte, pensado
-- para el flujo de IziPay. Ambas columnas se sincronizan al correr este script.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS gateway_status public.gateway_payment_status DEFAULT 'pending';

-- Sincronizar gateway_status desde status legacy para sesiones existentes
UPDATE public.payment_sessions
SET gateway_status = CASE
    WHEN status = 'initiated'         THEN 'pending'::public.gateway_payment_status
    WHEN status = 'gateway_confirmed' THEN 'processing'::public.gateway_payment_status
    WHEN status = 'completed'         THEN 'success'::public.gateway_payment_status
    WHEN status = 'failed'            THEN 'failed'::public.gateway_payment_status
    WHEN status = 'expired'           THEN 'expired'::public.gateway_payment_status
    ELSE                                   'pending'::public.gateway_payment_status
  END
WHERE gateway_status IS NULL
   OR gateway_status = 'pending';

COMMENT ON COLUMN public.payment_sessions.gateway_status IS
  'Estado tipado de la pasarela (gateway_payment_status). '
  'Refleja el estado del cobro externo, NO del procesamiento interno.';


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 5: ÍNDICE DE UNICIDAD en payment_transactions
-- ═══════════════════════════════════════════════════════════════════════════
-- El campo transaction_reference guarda el transactionUuid de IziPay.
-- Sin este índice, el webhook podría insertar/actualizar la misma fila N veces.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_pt_transaction_reference_unique
  ON public.payment_transactions (transaction_reference)
  WHERE transaction_reference IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 6: RPC apply_gateway_credit — "La Caja Fuerte Contable"
-- ═══════════════════════════════════════════════════════════════════════════
-- PROPÓSITO:
--   Esta es la ÚNICA función que debe usar cualquier webhook de pasarela
--   para acreditar saldo a un alumno. Reemplaza el uso directo de
--   adjust_student_balance en los Edge Functions de webhook.
--
-- GARANTÍAS:
--   a) IDEMPOTENTE: si llamas dos veces con el mismo gateway_reference_id,
--      la segunda llamada devuelve la transacción existente sin crear otra.
--   b) ATÓMICA: la transacción contable y el recálculo de saldo ocurren
--      en la misma operación SQL. Si algo falla → rollback automático.
--   c) TRAZABLE: cada crédito genera una fila en 'transactions' con el
--      gateway_reference_id, gateway_transaction_id y payment_session_id.
--      El trigger trg_log_student_balance_change registra el cambio de saldo.
--   d) DESACOPLADA DE TRIGGER: el saldo se recalcula automáticamente por
--      el trigger existente (on_transaction_created / trg_refresh_student_balance),
--      NO por update directo.
--
-- PARÁMETROS:
--   p_student_id         UUID    — alumno a quien se acredita
--   p_amount             NUMERIC — monto en soles (debe ser > 0)
--   p_session_id         UUID    — payment_sessions.id que originó el pago
--   p_gateway_ref_id     TEXT    — orderId de IziPay (REQUERIDO para idempotencia)
--   p_gateway_tx_id      TEXT    — transactionUuid del banco (opcional)
--   p_payment_method     TEXT    — 'visa','mastercard','yape_qr', etc.
--   p_description        TEXT    — descripción legible (opcional)
--   p_admin_id           UUID    — usuario que ejecuta (opcional; usa student si NULL)
--
-- RETORNA: JSONB con { success, idempotent, transaction_id, amount, message }
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_gateway_credit(
  p_student_id      UUID,
  p_amount          NUMERIC,
  p_session_id      UUID,
  p_gateway_ref_id  TEXT,
  p_gateway_tx_id   TEXT    DEFAULT NULL,
  p_payment_method  TEXT    DEFAULT 'online',
  p_description     TEXT    DEFAULT NULL,
  p_admin_id        UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id UUID;
  v_ticket    TEXT;
  v_tx_id     UUID;
  v_desc      TEXT;
BEGIN
  -- ── Validaciones de entrada ────────────────────────────────────────────
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: p_student_id es requerido';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: p_amount debe ser mayor a 0 (recibido: %)', p_amount;
  END IF;

  IF p_gateway_ref_id IS NULL OR trim(p_gateway_ref_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: p_gateway_ref_id es requerido para garantizar idempotencia';
  END IF;

  -- ── IDEMPOTENCIA: ¿ya procesamos este pago antes? ─────────────────────
  -- Busca una transacción no eliminada con el mismo gateway_reference_id.
  -- Si existe → retornar sin crear duplicado.
  SELECT id INTO v_tx_id
  FROM public.transactions
  WHERE gateway_reference_id = p_gateway_ref_id
    AND is_deleted = false
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success',        true,
      'idempotent',     true,
      'transaction_id', v_tx_id,
      'amount',         p_amount,
      'message',        'Crédito ya aplicado previamente — idempotente. Sin cambios.'
    );
  END IF;

  -- ── Obtener datos del alumno ───────────────────────────────────────────
  SELECT school_id INTO v_school_id
  FROM public.students
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND: No existe el alumno con id=%', p_student_id;
  END IF;

  -- ── Generar número de ticket ───────────────────────────────────────────
  BEGIN
    SELECT public.get_next_ticket_number(COALESCE(p_admin_id, p_student_id))
    INTO v_ticket;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback seguro si get_next_ticket_number falla
    v_ticket := 'GW-' || to_char(now() AT TIME ZONE 'America/Lima', 'YYYYMMDD-HH24MISS');
  END;

  -- ── Descripción legible ────────────────────────────────────────────────
  v_desc := COALESCE(
    p_description,
    'Recarga online vía pasarela — ' || UPPER(p_payment_method) ||
    ' (Ref: ' || p_gateway_ref_id || ')'
  );

  -- ── Insertar transacción contable con trazabilidad completa ───────────
  -- El trigger on_transaction_created recalculate automáticamente students.balance.
  -- El trigger trg_log_student_balance_change registrará el cambio de saldo.
  INSERT INTO public.transactions (
    student_id,
    school_id,
    type,
    amount,
    description,
    payment_status,
    payment_method,
    is_taxable,
    billing_status,
    ticket_code,
    payment_session_id,
    gateway_reference_id,
    gateway_transaction_id,
    created_by,
    metadata
  ) VALUES (
    p_student_id,
    v_school_id,
    'recharge',
    p_amount,
    v_desc,
    'paid',
    p_payment_method,
    false,
    'excluded',        -- boleta se genera por separado (Nubefact asíncrono)
    v_ticket,
    p_session_id,
    p_gateway_ref_id,
    p_gateway_tx_id,
    COALESCE(p_admin_id, p_student_id),
    jsonb_build_object(
      'source',            'gateway_webhook',
      'source_channel',    'online_payment',
      'gateway_name',      'izipay',
      'gateway_ref_id',    p_gateway_ref_id,
      'gateway_tx_id',     p_gateway_tx_id,
      'payment_session_id', p_session_id,
      'auto_applied',      true
    )
  )
  RETURNING id INTO v_tx_id;

  -- ── Marcar la sesión de pago como completada ───────────────────────────
  IF p_session_id IS NOT NULL THEN
    UPDATE public.payment_sessions
    SET
      status          = 'completed',
      gateway_status  = 'success',
      completed_at    = NOW()
    WHERE id = p_session_id
      AND status NOT IN ('completed', 'failed');  -- no sobrescribir estados terminales
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'idempotent',     false,
    'transaction_id', v_tx_id,
    'amount',         p_amount,
    'student_id',     p_student_id,
    'session_id',     p_session_id,
    'ticket',         v_ticket,
    'message',        'Crédito aplicado correctamente'
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise con contexto para debug
    RAISE EXCEPTION 'apply_gateway_credit FAILED [student=%, ref=%, amount=%]: %',
      p_student_id, p_gateway_ref_id, p_amount, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_gateway_credit(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, TEXT, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_gateway_credit IS
  'Caja Fuerte Contable: aplica un crédito de pasarela externa de forma atómica e idempotente. '
  'SIEMPRE usar esta función desde Edge Functions de webhook. NUNCA llamar adjust_student_balance '
  'directamente desde flujos de pasarela — usa esta función en su lugar.';


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 7: FUNCIÓN mark_webhook_processed — actualizar estado del evento
-- ═══════════════════════════════════════════════════════════════════════════
-- Llamar inmediatamente después de apply_gateway_credit para marcar el evento
-- como procesado. Separa el registro del evento de su procesamiento.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mark_webhook_processed(
  p_provider_name   TEXT,
  p_event_id        TEXT,
  p_session_id      UUID    DEFAULT NULL,
  p_error_message   TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.gateway_webhook_events
  SET
    processed_at       = CASE WHEN p_error_message IS NULL THEN NOW() ELSE NULL END,
    processing_error   = p_error_message,
    payment_session_id = COALESCE(p_session_id, payment_session_id),
    gateway_status     = CASE
                           WHEN p_error_message IS NULL THEN 'success'::public.gateway_payment_status
                           ELSE 'failed'::public.gateway_payment_status
                         END
  WHERE provider_name    = p_provider_name
    AND external_event_id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_webhook_processed(TEXT, TEXT, UUID, TEXT)
  TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASO 8: VERIFICACIÓN FINAL DE INTEGRIDAD
-- ═══════════════════════════════════════════════════════════════════════════
-- Ejecutar este bloque SELECT al terminar la migración para confirmar que
-- todos los objetos fueron creados correctamente.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  objeto,
  estado,
  detalle
FROM (
  SELECT 1 AS ord, 'TYPE gateway_payment_status'        AS objeto,
    CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gateway_payment_status' AND typtype = 'e')
         THEN '✅ OK' ELSE '❌ FALTA' END AS estado,
    'Máquina de estados para pasarelas externas' AS detalle

  UNION ALL SELECT 2, 'TABLE gateway_webhook_events',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema='public' AND table_name='gateway_webhook_events')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'Escudo de idempotencia — eventos únicos por (provider, event_id)'

  UNION ALL SELECT 3, 'INDEX idx_gwhe_provider_event (UNIQUE)',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                      WHERE tablename='gateway_webhook_events' AND indexname='idx_gwhe_provider_event')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'Garantiza que el mismo webhook no se procese dos veces'

  UNION ALL SELECT 4, 'COL transactions.payment_session_id',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='transactions' AND column_name='payment_session_id')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'FK opcional hacia payment_sessions'

  UNION ALL SELECT 5, 'COL transactions.gateway_reference_id',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='transactions' AND column_name='gateway_reference_id')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'orderId de IziPay para trazabilidad'

  UNION ALL SELECT 6, 'COL transactions.gateway_transaction_id',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='transactions' AND column_name='gateway_transaction_id')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'transactionUuid del banco para trazabilidad'

  UNION ALL SELECT 7, 'INDEX idx_tx_gateway_ref_unique (UNIQUE)',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                      WHERE tablename='transactions' AND indexname='idx_tx_gateway_ref_unique')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'Segundo escudo: un pago no genera 2 transacciones contables'

  UNION ALL SELECT 8, 'COL payment_sessions.gateway_status',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='payment_sessions' AND column_name='gateway_status')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'Estado tipado de pasarela en sesiones de pago'

  UNION ALL SELECT 9, 'RPC apply_gateway_credit',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname='public' AND p.proname='apply_gateway_credit')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'Caja fuerte contable — único punto de entrada para créditos de pasarela'

  UNION ALL SELECT 10, 'RPC mark_webhook_processed',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname='public' AND p.proname='mark_webhook_processed')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'Marca un evento webhook como procesado/fallido'

  UNION ALL SELECT 11, 'INDEX idx_pt_transaction_reference_unique (UNIQUE)',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                      WHERE tablename='payment_transactions' AND indexname='idx_pt_transaction_reference_unique')
         THEN '✅ OK' ELSE '❌ FALTA' END,
    'Idempotencia en payment_transactions por transaction_reference'

) v
ORDER BY ord;
