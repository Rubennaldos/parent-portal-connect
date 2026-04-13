-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: void_payment — Anulación de Pagos Aprobados
-- Fecha: 2026-04-13
--
-- PROPÓSITO:
--   Permite anular un pago aprobado (recharge_request.status = 'approved')
--   de forma atómica y auditada. Incluye:
--     1. Extensión del CHECK de status para admitir 'voided'
--     2. Nuevas columnas de auditoría en recharge_requests
--     3. original_invoice_id en invoices para Notas de Crédito
--     4. Índices de rendimiento para búsqueda por metadata
--     5. Función void_payment(p_request_id, p_admin_id, p_reason)
--
-- REGLAS DE NEGOCIO:
--   - Solo se pueden anular pagos con status = 'approved'
--   - Los pagos split (wallet_amount > 0) están bloqueados — reversión manual
--   - recharge: descuenta el monto del balance (puede quedar negativo = deuda real)
--   - lunch/debt: revierte transacciones a 'pending' y lunch_orders a 'pending'
--   - Nota de Crédito SUNAT código 07 se crea SOLO si existe boleta original
--   - La anulación procede aunque la Nota de Crédito falle (best-effort)
-- ══════════════════════════════════════════════════════════════════════════════


-- ── BLOQUE A: Extender CHECK constraint de status ────────────────────────────
-- El constraint fue creado inline en CREATE TABLE → PostgreSQL lo nombra
-- 'recharge_requests_status_check'. Hay que drop + recrear para añadir 'voided'.

ALTER TABLE recharge_requests
  DROP CONSTRAINT IF EXISTS recharge_requests_status_check;

ALTER TABLE recharge_requests
  ADD CONSTRAINT recharge_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'voided'));


-- ── BLOQUE B: Nuevas columnas de auditoría en recharge_requests ───────────────

ALTER TABLE recharge_requests
  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

COMMENT ON COLUMN recharge_requests.voided_by   IS 'Admin que realizó la anulación';
COMMENT ON COLUMN recharge_requests.voided_at   IS 'Timestamp de la anulación';
COMMENT ON COLUMN recharge_requests.void_reason IS 'Motivo de la anulación';


-- ── BLOQUE C: original_invoice_id en invoices (para Nota de Crédito) ─────────
-- Solo se ejecuta si la tabla invoices ya existe en este proyecto.
-- Si no existe, la Nota de Crédito se omitirá (best-effort en la función).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'invoices'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS original_invoice_id UUID REFERENCES invoices(id);

    COMMENT ON COLUMN invoices.original_invoice_id IS
      'FK a la boleta/factura original. Solo se usa en Notas de Crédito (document_type_code=07).';

    RAISE NOTICE 'Columna original_invoice_id añadida a invoices.';
  ELSE
    RAISE NOTICE 'Tabla invoices no existe aún — columna original_invoice_id omitida.';
  END IF;
END;
$$;


-- ── BLOQUE D: Índices de rendimiento ─────────────────────────────────────────
-- Crítico: sin índice en metadata->>'recharge_request_id', la búsqueda en
-- transactions es un seq scan completo. Con miles de registros, esto
-- puede tardar varios segundos.

CREATE INDEX IF NOT EXISTS idx_tx_metadata_rr_id
  ON transactions ((metadata->>'recharge_request_id'));

CREATE INDEX IF NOT EXISTS idx_rr_voided_at
  ON recharge_requests (voided_at) WHERE status = 'voided';

CREATE INDEX IF NOT EXISTS idx_rr_status_voided
  ON recharge_requests (status) WHERE status = 'voided';


-- ── BLOQUE E: Función void_payment ────────────────────────────────────────────

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
  -- FOR UPDATE adquiere row-level lock → previene doble anulación concurrente.
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

  -- Pagos split (billetera interna) requieren reversión manual —
  -- involucran wallet_transactions y adjust_student_wallet_balance,
  -- un flujo distinto al que esta función gestiona.
  IF COALESCE(v_req.wallet_amount, 0) > 0 THEN
    RAISE EXCEPTION 'SPLIT_PAYMENT: Los pagos con billetera interna (wallet_amount=S/ %) requieren reversión manual. Contacta soporte técnico.', v_req.wallet_amount;
  END IF;

  -- ── PASO 2: MARCAR SOLICITUD COMO ANULADA ────────────────────────────────
  UPDATE recharge_requests
  SET    status      = 'voided',
         voided_by   = p_admin_id,
         voided_at   = NOW(),
         void_reason = p_reason
  WHERE  id = p_request_id;

  -- ── PASO 3: LÓGICA DE REVERSIÓN POR TIPO ─────────────────────────────────

  IF COALESCE(v_req.request_type, 'recharge') = 'recharge' THEN

    -- ─── CASO A: RECARGA DE SALDO ───────────────────────────────────────────
    -- Buscar la transacción de recarga vía metadata (transaction_id NO se graba
    -- en recharge_requests para recargas — el vínculo va por metadata).

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

    -- Descontar del balance de forma atómica.
    -- Puede dejar el saldo negativo — eso es correcto, es una deuda real
    -- (el alumno usó dinero que luego fue anulado).
    PERFORM adjust_student_balance(v_req.student_id, -(v_req.amount));
    v_balance_deducted := v_req.amount;

  ELSE

    -- ─── CASO B: PAGO DE DEUDA / PAGO DE ALMUERZO ──────────────────────────
    -- process_traditional_voucher_approval v4 graba en PASO 5:
    --   metadata->>'recharge_request_id' = p_request_id
    -- en TODAS las transacciones que marcó como 'paid'.
    -- Esa es la fuente de verdad para la reversión.

    SELECT array_agg(id) INTO v_tx_ids
    FROM   transactions
    WHERE  metadata->>'recharge_request_id' = p_request_id::text
      AND  payment_status = 'paid'
      AND  is_deleted     = false;

    v_lunch_ids := COALESCE(v_req.lunch_order_ids, '{}');

    -- Revertir transacciones: 'paid' → 'pending'
    IF COALESCE(cardinality(v_tx_ids), 0) > 0 THEN
      UPDATE transactions t
      SET    payment_status = 'pending',
             payment_method = NULL,
             is_taxable     = false,
             billing_status = NULL,
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

    -- Revertir ajuste de balance para transacciones de kiosco.
    -- Solo las compras de kiosco (sin lunch_order_id) afectaron el balance
    -- en los pasos 6b/6c de process_traditional_voucher_approval.
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

        -- Deducir solo hasta el saldo actual positivo para no crear
        -- deuda ficticia (la deuda kiosco ya volvió a 'pending').
        v_balance_deducted := LEAST(v_kiosk_sum, GREATEST(0, v_current_balance));

        IF v_balance_deducted > 0.01 THEN
          PERFORM adjust_student_balance(v_req.student_id, -v_balance_deducted);
        END IF;
      END IF;
    END IF;

  END IF;

  -- ── PASO 4: NOTA DE CRÉDITO SUNAT (código 07) — BEST-EFFORT ──────────────
  -- Se crea solo si existe boleta/factura original vinculada.
  -- Bloque BEGIN...EXCEPTION garantiza que un fallo aquí no revierta la anulación.
  BEGIN

    -- Buscar boleta/factura original via transactions.invoice_id
    -- La sede se obtiene directamente de la boleta original (v_orig_invoice.school_id)
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
      -- Serie NC: 'NC' + primeros 2 chars de la serie original
      -- e.g.: serie='B001' → serie_nc='NCB0'
      -- El correlativo es atómico por sede (school_id) via get_next_invoice_numero
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
        NULL,    -- La NC no tiene transacción directa
        '07',    -- Código SUNAT: Nota de Crédito Electrónica
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
        v_orig_invoice.id   -- Referencia a la boleta original
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
        'credit_note_id',    v_credit_note_id
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
  'Anula un pago aprobado de forma atómica.
   - recharge: cancela la tx de recarga y descuenta el monto del balance
   - lunch/debt: revierte transacciones a pending y lunch_orders a pending
   - Genera Nota de Crédito SUNAT (código 07) si existe boleta original
   - Los pagos split (wallet_amount > 0) están bloqueados — reversión manual
   - Auditoría en huella_digital_logs (best-effort)';

NOTIFY pgrst, 'reload schema';
SELECT 'void_payment creado OK' AS resultado;
