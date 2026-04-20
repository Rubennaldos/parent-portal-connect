-- ══════════════════════════════════════════════════════════════════════════════
-- HERRAMIENTA DE CONCILIACIÓN MANUAL DE EMERGENCIA
-- Fecha: 2026-04-19
-- ──────────────────────────────────────────────────────────────────────────────
-- PROPÓSITO:
--   El Webhook de IziPay no llegó (URL no configurada en el back-office o
--   fallo de red). El padre pagó y el dinero fue debitado, pero la BD no lo
--   sabe. Esta función permite a un admin con acceso a Supabase SQL Editor
--   acreditar el pago manualmente, dejando huella forense completa.
--
-- FLUJO DE USO:
--   1. Admin verifica en el Dashboard de IziPay/Lyra que el pago fue aprobado
--      (orderStatus = PAID). Anota el orderId y el transactionUuid.
--   2. Admin busca el student_id y payment_session_id en la BD.
--   3. Admin llama a manual_gateway_credit() con los datos verificados.
--   4. La función llama a apply_gateway_credit() (misma caja fuerte del webhook)
--      con un flag de origen manual. El saldo sube, la deuda se salda.
--
-- GARANTÍAS:
--   a) IDEMPOTENTE: si se llama dos veces con el mismo gateway_ref_id, la
--      segunda llamada devuelve el resultado anterior sin duplicar.
--   b) AUDITADA: crea un registro en manual_reconciliation_log con quién,
--      cuándo, cuánto y por qué se hizo la conciliación.
--   c) SEGURA: SECURITY DEFINER — solo roles con acceso al SQL Editor pueden
--      ejecutar esto. No es accesible desde el frontend.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLA DE LOG DE CONCILIACIONES MANUALES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manual_reconciliation_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Quién hizo la conciliación (admin que la ejecutó)
  reconciled_by         UUID        REFERENCES auth.users(id),
  reconciled_by_email   TEXT,

  -- Datos del pago original
  gateway_name          TEXT        NOT NULL DEFAULT 'izipay',
  gateway_ref_id        TEXT        NOT NULL,
  gateway_tx_id         TEXT,
  student_id            UUID        NOT NULL REFERENCES public.students(id),
  amount                NUMERIC(10,2) NOT NULL,
  currency              TEXT        NOT NULL DEFAULT 'PEN',

  -- Sesión de pago relacionada (si se puede identificar)
  payment_session_id    UUID        REFERENCES public.payment_sessions(id),

  -- Resultado
  new_transaction_id    UUID,
  was_idempotent        BOOLEAN     NOT NULL DEFAULT false,

  -- Evidencia y justificación
  evidence_notes        TEXT,       -- Ej: "Verificado en Dashboard IziPay: orden #XXX pago PAID"
  izipay_dashboard_ref  TEXT,       -- Nro. de operación del comprobante del padre

  -- Por qué fue necesaria la conciliación manual
  failure_reason        TEXT        DEFAULT 'webhook_not_received'
);

COMMENT ON TABLE public.manual_reconciliation_log IS
  'Registro de conciliaciones manuales de emergencia. '
  'Cada fila representa un pago aprobado por el gateway que no llegó por webhook '
  'y fue acreditado manualmente por un administrador con evidencia verificada.';

CREATE INDEX IF NOT EXISTS idx_mrlog_gateway_ref
  ON public.manual_reconciliation_log (gateway_ref_id);

CREATE INDEX IF NOT EXISTS idx_mrlog_student
  ON public.manual_reconciliation_log (student_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCIÓN: manual_gateway_credit
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manual_gateway_credit(
  -- Datos del pago verificado en el dashboard de IziPay
  p_gateway_ref_id      TEXT,       -- orderId de IziPay (el UUID de la orden)
  p_student_id          UUID,       -- alumno al que se acredita
  p_amount              NUMERIC,    -- monto en soles (exactamente lo que cobró IziPay)
  p_evidence_notes      TEXT,       -- "Verificado en Dashboard IziPay: PAID, fecha X, comprobante Y"
  p_izipay_dashboard_ref TEXT DEFAULT NULL, -- Nro. de operación del comprobante del padre
  p_gateway_tx_id       TEXT DEFAULT NULL, -- transactionUuid (si disponible en el dashboard)
  p_reconciled_by_email TEXT DEFAULT 'admin@sistema',
  p_session_id          UUID DEFAULT NULL  -- payment_session_id (si se puede identificar)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credit_result   JSONB;
  v_credit_error    TEXT;
  v_log_id          UUID;
  v_was_idempotent  BOOLEAN := false;
  v_new_tx_id       UUID;
BEGIN
  -- ── Validaciones básicas ────────────────────────────────────────────────
  IF p_gateway_ref_id IS NULL OR trim(p_gateway_ref_id) = '' THEN
    RAISE EXCEPTION 'INVALID_REF_ID: Se requiere el orderId de IziPay.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: El monto debe ser mayor a 0.';
  END IF;

  IF p_evidence_notes IS NULL OR trim(p_evidence_notes) = '' THEN
    RAISE EXCEPTION 'MISSING_EVIDENCE: Se requiere justificación con evidencia verificada.';
  END IF;

  -- ── Verificar idempotencia: ¿ya existe un crédito para este ref_id? ─────
  SELECT id INTO v_new_tx_id
  FROM public.transactions
  WHERE gateway_reference_id = p_gateway_ref_id
    AND is_deleted = false
  LIMIT 1;

  IF v_new_tx_id IS NOT NULL THEN
    -- Ya fue acreditado (ya sea por webhook tardío o conciliación previa)
    v_was_idempotent := true;
    RAISE NOTICE 'IDEMPOTENTE: gateway_ref_id=% ya tiene transacción %. Sin cambios.', 
      p_gateway_ref_id, v_new_tx_id;
    RETURN jsonb_build_object(
      'success',       true,
      'idempotent',    true,
      'message',       'Este pago ya fue acreditado anteriormente. Sin cambios.',
      'transaction_id', v_new_tx_id
    );
  END IF;

  -- ── Llamar a apply_gateway_credit (la misma caja fuerte del webhook) ────
  BEGIN
    SELECT result INTO v_credit_result
    FROM public.apply_gateway_credit(
      p_student_id     := p_student_id,
      p_amount         := p_amount,
      p_session_id     := p_session_id,
      p_gateway_ref_id := p_gateway_ref_id,
      p_gateway_tx_id  := p_gateway_tx_id,
      p_payment_method := 'manual_reconciliation',
      p_description    := format(
        'Conciliación manual — IziPay (evidencia: %s) ref:%s',
        p_evidence_notes,
        p_gateway_ref_id
      )
    ) AS result;

    v_was_idempotent := (v_credit_result->>'idempotent')::boolean;
    v_new_tx_id      := (v_credit_result->>'transaction_id')::uuid;

  EXCEPTION WHEN OTHERS THEN
    v_credit_error := SQLERRM;
    RAISE EXCEPTION 'CREDIT_FAILED: apply_gateway_credit falló: %', v_credit_error;
  END;

  -- ── Registrar la conciliación manual ────────────────────────────────────
  INSERT INTO public.manual_reconciliation_log (
    reconciled_by_email,
    gateway_name,
    gateway_ref_id,
    gateway_tx_id,
    student_id,
    amount,
    payment_session_id,
    new_transaction_id,
    was_idempotent,
    evidence_notes,
    izipay_dashboard_ref,
    failure_reason
  ) VALUES (
    p_reconciled_by_email,
    'izipay',
    p_gateway_ref_id,
    p_gateway_tx_id,
    p_student_id,
    p_amount,
    p_session_id,
    v_new_tx_id,
    v_was_idempotent,
    p_evidence_notes,
    p_izipay_dashboard_ref,
    'webhook_not_received'
  )
  RETURNING id INTO v_log_id;

  RAISE NOTICE 'Conciliación manual completada. log_id=% tx_id=% alumno=% monto=%',
    v_log_id, v_new_tx_id, p_student_id, p_amount;

  RETURN jsonb_build_object(
    'success',          true,
    'idempotent',       v_was_idempotent,
    'log_id',           v_log_id,
    'transaction_id',   v_new_tx_id,
    'message',          format('Pago acreditado manualmente. S/ %s para alumno %s', p_amount, p_student_id)
  );
END;
$$;

COMMENT ON FUNCTION public.manual_gateway_credit IS
  'HERRAMIENTA DE EMERGENCIA: acredita un pago IziPay verificado manualmente. '
  'Usar SOLO cuando el webhook no llegó y el admin verificó el pago en el dashboard de IziPay. '
  'Deja huella completa en manual_reconciliation_log.';


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCIÓN AUXILIAR: buscar_sesion_por_alumno
-- Para identificar el payment_session_id a usar en la conciliación
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.buscar_sesion_izipay_reciente(
  p_student_id  UUID,
  p_desde       TIMESTAMPTZ DEFAULT NOW() - INTERVAL '24 hours'
)
RETURNS TABLE (
  session_id       UUID,
  gateway_ref      TEXT,
  gateway_status   TEXT,
  amount           NUMERIC,
  created_at       TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ps.id,
    ps.gateway_reference,
    ps.gateway_status::TEXT,
    ps.gateway_amount,
    ps.created_at,
    ps.expires_at
  FROM public.payment_sessions ps
  WHERE ps.student_id  = p_student_id
    AND ps.gateway_name = 'izipay'
    AND ps.created_at >= p_desde
  ORDER BY ps.created_at DESC
  LIMIT 10;
$$;
