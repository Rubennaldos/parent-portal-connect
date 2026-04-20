-- ══════════════════════════════════════════════════════════════════════════════
-- FIX CRÍTICO: apply_gateway_credit y manual_gateway_credit
-- Fecha: 2026-04-20
-- ──────────────────────────────────────────────────────────────────────────────
-- PROBLEMA QUE RESUELVE (BUG RAÍZ — TODOS los pagos IziPay fallaban):
--
--   apply_gateway_credit tenía esta línea en el INSERT de transactions:
--     created_by = COALESCE(p_admin_id, p_student_id)
--
--   Cuando el webhook llama la función SIN p_admin_id (que es el 100% de los casos),
--   COALESCE devuelve p_student_id. Pero transactions.created_by tiene FK a auth.users
--   y los alumnos NO están en auth.users → ERROR: violates foreign key constraint
--   "transactions_created_by_fkey".
--
--   La función lanzaba excepción → el webhook recibía error → devolvía 200 OK a IziPay
--   (para que no reintente) → el saldo NUNCA subía → el padre veía "Pendiente" para siempre.
--
-- SOLUCIÓN:
--   Usar p_admin_id directamente (NULL cuando no hay admin).
--   NULL es válido en una FK nullable y semánticamente correcto: significa
--   "operación iniciada por el sistema / webhook automático".
--
-- EFECTO EN FLUJOS:
--   Webhook IziPay → apply_gateway_credit(p_admin_id=NULL) → created_by=NULL ✅
--   Manual admin   → apply_gateway_credit(p_admin_id=uuid) → created_by=uuid ✅
--   manual_gateway_credit → busca UUID del admin por email → pasa p_admin_id ✅
-- ══════════════════════════════════════════════════════════════════════════════


-- ── FIX 1: apply_gateway_credit ───────────────────────────────────────────────
-- Solo se cambia la línea 377 (COALESCE → p_admin_id directo).
-- El resto de la función es IDÉNTICO a la versión original.

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
  -- Usa p_admin_id si existe, o un valor dummy estable para el generador.
  -- El ticket en sí no importa para el FK — es solo un código de texto.
  BEGIN
    SELECT public.get_next_ticket_number(COALESCE(p_admin_id, p_student_id))
    INTO v_ticket;
  EXCEPTION WHEN OTHERS THEN
    v_ticket := 'GW-' || to_char(now() AT TIME ZONE 'America/Lima', 'YYYYMMDD-HH24MISS');
  END;

  -- ── Descripción legible ────────────────────────────────────────────────
  v_desc := COALESCE(
    p_description,
    'Recarga online vía pasarela — ' || UPPER(p_payment_method) ||
    ' (Ref: ' || p_gateway_ref_id || ')'
  );

  -- ── Insertar transacción contable ─────────────────────────────────────
  -- FIX: created_by = p_admin_id (puede ser NULL para operaciones de sistema/webhook)
  --      NUNCA usar p_student_id aquí porque student.id no existe en auth.users.
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
    'excluded',
    v_ticket,
    p_session_id,
    p_gateway_ref_id,
    p_gateway_tx_id,
    p_admin_id,        -- ✅ FIX: NULL cuando es webhook automático (válido en FK nullable)
    jsonb_build_object(
      'source',             'gateway_webhook',
      'source_channel',     'online_payment',
      'gateway_name',       'izipay',
      'gateway_ref_id',     p_gateway_ref_id,
      'gateway_tx_id',      p_gateway_tx_id,
      'payment_session_id', p_session_id,
      'auto_applied',       true
    )
  )
  RETURNING id INTO v_tx_id;

  -- ── Marcar la sesión de pago como completada ───────────────────────────
  IF p_session_id IS NOT NULL THEN
    UPDATE public.payment_sessions
    SET
      status         = 'completed',
      gateway_status = 'success',
      completed_at   = NOW()
    WHERE id = p_session_id
      AND status NOT IN ('completed', 'failed');
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
    RAISE EXCEPTION 'apply_gateway_credit FAILED [student=%, ref=%, amount=%]: %',
      p_student_id, p_gateway_ref_id, p_amount, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_gateway_credit(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, TEXT, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_gateway_credit IS
  'Caja Fuerte Contable: aplica un crédito de pasarela externa de forma atómica e idempotente. '
  'FIX 2026-04-20: created_by usa p_admin_id directo (NULL para webhooks automáticos). '
  'NUNCA usar p_student_id como created_by — viola FK transactions_created_by_fkey.';


-- ── FIX 2: manual_gateway_credit ─────────────────────────────────────────────
-- Ahora busca el UUID del admin en auth.users por email y lo pasa a
-- apply_gateway_credit como p_admin_id, garantizando la FK y el trail de auditoría.

CREATE OR REPLACE FUNCTION public.manual_gateway_credit(
  p_gateway_ref_id       TEXT,
  p_student_id           UUID,
  p_amount               NUMERIC,
  p_evidence_notes       TEXT,
  p_izipay_dashboard_ref TEXT DEFAULT NULL,
  p_gateway_tx_id        TEXT DEFAULT NULL,
  p_reconciled_by_email  TEXT DEFAULT 'admin@sistema',
  p_session_id           UUID DEFAULT NULL
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
  v_admin_id        UUID;
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

  -- ── Buscar UUID del admin en auth.users ──────────────────────────────────
  -- FIX: pasar p_admin_id válido para cumplir el FK de transactions.created_by
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE email = p_reconciled_by_email
  LIMIT 1;

  -- Si no se encuentra el email, v_admin_id queda NULL (igualmente válido en FK nullable)
  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'manual_gateway_credit: email % no encontrado en auth.users. created_by quedará NULL.', p_reconciled_by_email;
  END IF;

  -- ── Verificar idempotencia ─────────────────────────────────────────────
  SELECT id INTO v_new_tx_id
  FROM public.transactions
  WHERE gateway_reference_id = p_gateway_ref_id
    AND is_deleted = false
  LIMIT 1;

  IF v_new_tx_id IS NOT NULL THEN
    v_was_idempotent := true;
    RAISE NOTICE 'IDEMPOTENTE: gateway_ref_id=% ya tiene transacción %. Sin cambios.',
      p_gateway_ref_id, v_new_tx_id;
    RETURN jsonb_build_object(
      'success',        true,
      'idempotent',     true,
      'message',        'Este pago ya fue acreditado anteriormente. Sin cambios.',
      'transaction_id', v_new_tx_id
    );
  END IF;

  -- ── Llamar a apply_gateway_credit con admin_id correcto ───────────────
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
      ),
      p_admin_id       := v_admin_id   -- ✅ FIX: UUID real de auth.users (o NULL si no encontrado)
    ) AS result;

    v_was_idempotent := COALESCE((v_credit_result->>'idempotent')::boolean, false);
    v_new_tx_id      := (v_credit_result->>'transaction_id')::uuid;

  EXCEPTION WHEN OTHERS THEN
    v_credit_error := SQLERRM;
    RAISE EXCEPTION 'CREDIT_FAILED: apply_gateway_credit falló: %', v_credit_error;
  END;

  -- ── Registrar la conciliación manual ────────────────────────────────────
  INSERT INTO public.manual_reconciliation_log (
    reconciled_by,
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
    v_admin_id,
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
    'success',        true,
    'idempotent',     v_was_idempotent,
    'log_id',         v_log_id,
    'transaction_id', v_new_tx_id,
    'message',        format('Pago acreditado manualmente. S/ %s para alumno %s', p_amount, p_student_id)
  );
END;
$$;

COMMENT ON FUNCTION public.manual_gateway_credit IS
  'HERRAMIENTA DE EMERGENCIA: acredita un pago IziPay verificado manualmente. '
  'FIX 2026-04-20: busca UUID del admin en auth.users para cumplir FK created_by. '
  'Deja huella completa en manual_reconciliation_log.';


-- ── VERIFICACIÓN FINAL ─────────────────────────────────────────────────────────
-- Confirma que la función fue actualizada correctamente
SELECT
  proname,
  CASE
    WHEN prosrc LIKE '%p_admin_id,        -- ✅ FIX%' OR prosrc LIKE '%p_admin_id       ,-- ✅%'
      OR prosrc LIKE '%p_admin_id%NULL%válido%'
      OR (prosrc NOT LIKE '%COALESCE(p_admin_id, p_student_id)%')
    THEN '✅ FK FIX aplicado'
    ELSE '❌ Aún tiene COALESCE(p_admin_id, p_student_id)'
  END AS estado
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('apply_gateway_credit', 'manual_gateway_credit')
ORDER BY proname;
