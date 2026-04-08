-- ============================================================
-- ESCUDO DE INTEGRIDAD SUNAT — protect_sent_transactions
-- ============================================================
-- Propósito:
--   Impedir que cualquier UPDATE o DELETE modifique campos
--   financieros de una transacción ya informada a SUNAT/Nubefact
--   (billing_status = 'sent').
--
-- Fundamento legal:
--   Art. 174° Código Tributario Peruano: modificar comprobantes
--   electrónicos ya aceptados por SUNAT sin emitir la
--   correspondiente Nota de Crédito constituye una infracción
--   sancionada con cierre de establecimiento.
--
-- Excepciones controladas (operaciones legítimas del sistema):
--   E1 — Vincular invoice_id: el Panel de Rescate encontró el
--         comprobante en Nubefact y lo está enlazando en BD.
--         Solo se permite cuando invoice_id era NULL y los campos
--         financieros no cambian.
--   E2 — Devolver huérfana a pending: la transacción tiene
--         billing_status='sent' pero invoice_id IS NULL, lo que
--         significa que NUNCA llegó realmente a SUNAT. El Panel
--         de Rescate la devuelve a la cola de boleteado.
--         Solo se permite cuando invoice_id es NULL antes y después.
--
-- Operaciones que SIEMPRE bloquea:
--   - Cambiar amount, payment_status, student_id, teacher_id,
--     school_id, type o is_deleted en una fila 'sent'
--   - Bajar billing_status de 'sent' cuando invoice_id ya fue vinculado
--   - Cambiar invoice_id ya vinculado por otro UUID
--   - DELETE directo sobre cualquier fila 'sent'
-- ============================================================


-- ── FUNCIÓN DEL TRIGGER ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_prevent_modifying_sent_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── Guardia de entrada: solo aplica cuando la fila YA era 'sent' ──────────
  -- Las transiciones hacia 'sent' (pending → processing → sent) son legítimas.
  IF OLD.billing_status <> 'sent' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOQUEO ABSOLUTO: DELETE
  -- Sin excepción. Para anular un comprobante en SUNAT se emite NC,
  -- nunca se borra la fila original.
  -- ══════════════════════════════════════════════════════════════════════════
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % ya fue informada a la SUNAT '
      '(invoice_id: %). No se permite el borrado directo. '
      'Para anularla emite una Nota de Crédito desde el módulo de Facturación. '
      'El borrado de comprobantes electrónicos emitidos es sancionado por el '
      'Art. 174° del Código Tributario Peruano.',
      OLD.id, OLD.invoice_id
    USING ERRCODE = 'P0001';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- EXCEPCIONES PERMITIDAS (UPDATE)
  -- Se evalúan antes del bloqueo general.
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── EXCEPCIÓN 1: Vincular invoice_id (rescate de zombie confirmado) ───────
  -- Situación: CierreMensual emitió la boleta en Nubefact, pero la BD
  --   quedó con billing_status='sent' y invoice_id=NULL (corte de red).
  --   El Panel de Rescate encontró el comprobante en Nubefact y lo vincula.
  -- Qué cambia: SOLO invoice_id (de NULL → UUID). Nada más.
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
    -- Registrar la vinculación en log (no bloquear)
    RAISE NOTICE '[SUNAT_INTEGRITY] Transacción % vinculada a invoice_id % (rescate OK).',
      OLD.id, NEW.invoice_id;
    RETURN NEW;
  END IF;

  -- ── EXCEPCIÓN 2: Devolver huérfana a pending (nunca llegó a SUNAT) ────────
  -- Situación: la transacción quedó en billing_status='sent' pero
  --   invoice_id=NULL porque el proceso murió antes de guardar el resultado
  --   de Nubefact. No hay evidencia de que llegó a SUNAT.
  --   El Panel de Rescate la devuelve a 'pending' para ser boleteada.
  -- Condición: invoice_id era NULL y sigue siendo NULL.
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

  -- ══════════════════════════════════════════════════════════════════════════
  -- BLOQUEO GENERAL: campos financieros críticos
  -- Cualquier cambio en estos campos es una modificación contable ilegal
  -- sobre un comprobante ya registrado en SUNAT.
  -- ══════════════════════════════════════════════════════════════════════════

  -- 1. Monto — el valor declarado a SUNAT
  IF OLD.amount IS DISTINCT FROM NEW.amount THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se puede cambiar el monto (S/ % → S/ %). '
      'Para corregir un error de importe emite una Nota de Crédito.',
      OLD.id, OLD.invoice_id, OLD.amount, NEW.amount
    USING ERRCODE = 'P0001';
  END IF;

  -- 2. Estado de pago — no se puede cancelar/revertir lo ya cobrado y boleteado
  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se puede cambiar payment_status (% → %) en una transacción ya informada a SUNAT. '
      'Emite una Nota de Crédito.',
      OLD.id, OLD.invoice_id, OLD.payment_status, NEW.payment_status
    USING ERRCODE = 'P0001';
  END IF;

  -- 3. Cliente / sede / tipo — la identidad fiscal del comprobante
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

  -- 4. Soft-delete — equivale a borrado, igualmente bloqueado
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

  -- 5. invoice_id ya vinculado — no puede cambiar a otro (evita falsear el vínculo)
  IF OLD.invoice_id IS NOT NULL
     AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
  THEN
    RAISE EXCEPTION
      '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
      'No se puede cambiar invoice_id una vez vinculado a un comprobante emitido.',
      OLD.id, OLD.invoice_id
    USING ERRCODE = 'P0001';
  END IF;

  -- 6. billing_status — ya vinculado no puede bajar de 'sent'
  --    (las excepciones 1 y 2 ya manejan los casos legítimos de descenso)
  IF NEW.billing_status <> 'sent' THEN
    IF OLD.invoice_id IS NOT NULL THEN
      RAISE EXCEPTION
        '[SUNAT_INTEGRITY] Transacción % (invoice_id: %): '
        'No se puede revertir billing_status de "sent" a "%" cuando '
        'ya existe un invoice_id vinculado. Emite una Nota de Crédito.',
        OLD.id, OLD.invoice_id, NEW.billing_status
      USING ERRCODE = 'P0001';
    ELSE
      -- invoice_id IS NULL pero el nuevo estado no es 'pending'/'processing'
      -- (esas rutas ya fueron evaluadas en E2 y no llegaron hasta aquí)
      RAISE EXCEPTION
        '[SUNAT_INTEGRITY] Transacción % (billing_status=sent, sin invoice_id): '
        'cambio a "%" no permitido. Usa el Panel de Rescate para gestionar '
        'transacciones huérfanas.',
        OLD.id, NEW.billing_status
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Campos no críticos (notes, metadata, ticket_code, etc.): PERMITIDO ────
  -- Solo se llega aquí si ningún campo financiero cambió.
  RETURN NEW;

END;
$$;

COMMENT ON FUNCTION fn_prevent_modifying_sent_transactions IS
  'Trigger BEFORE UPDATE/DELETE que protege la integridad contable de '
  'transacciones ya informadas a SUNAT (billing_status=sent). '
  'Excepciones: vinculación de invoice_id (E1) y rescate de huérfana sin '
  'invoice_id (E2). Todo lo demás requiere Nota de Crédito.';


-- ── APLICAR EL TRIGGER ────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_protect_sent_transactions ON transactions;

CREATE TRIGGER trg_protect_sent_transactions
  BEFORE UPDATE OR DELETE
  ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_modifying_sent_transactions();

COMMENT ON TRIGGER trg_protect_sent_transactions ON transactions IS
  'Escudo de integridad SUNAT. Activa fn_prevent_modifying_sent_transactions '
  'antes de cualquier UPDATE o DELETE sobre la tabla transactions. '
  'Ver la función para las excepciones controladas (Panel de Rescate).';


-- ════════════════════════════════════════════════════════════════════════════════
-- SCRIPT DE VERIFICACIÓN (EJECUTAR MANUALMENTE PARA CONFIRMAR EL TRIGGER)
-- Copia cada bloque en el SQL Editor de Supabase y confirma que el resultado
-- coincide con el comentario.
-- ════════════════════════════════════════════════════════════════════════════════

/*

-- ── TEST 1: DELETE sobre transacción 'sent' → debe FALLAR ──────────────────
-- Sustituye el UUID por uno real de tu tabla transactions.

DO $$
DECLARE
  v_fake_id uuid := gen_random_uuid();
BEGIN
  -- Insertar fila de prueba con billing_status='sent'
  INSERT INTO transactions (
    id, type, amount, payment_status, payment_method,
    school_id, is_taxable, billing_status, invoice_id, created_at
  )
  SELECT
    v_fake_id, 'purchase', 100.00, 'paid', 'yape',
    id, true, 'sent', gen_random_uuid(), now()
  FROM schools LIMIT 1;

  -- Intentar borrar → debe lanzar P0001
  BEGIN
    DELETE FROM transactions WHERE id = v_fake_id;
    RAISE NOTICE 'ERROR: el DELETE no fue bloqueado (el trigger no funciona)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK: DELETE bloqueado correctamente. Mensaje: %', SQLERRM;
  END;

  -- Limpiar la fila de prueba (funciona porque no se ejecutó el DELETE)
  DELETE FROM transactions WHERE id = v_fake_id;
  RAISE NOTICE 'TEST 1 COMPLETADO.';
END;
$$;


-- ── TEST 2: UPDATE de amount en transacción 'sent' → debe FALLAR ───────────

DO $$
DECLARE
  v_fake_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO transactions (
    id, type, amount, payment_status, payment_method,
    school_id, is_taxable, billing_status, invoice_id, created_at
  )
  SELECT
    v_fake_id, 'purchase', 150.00, 'paid', 'efectivo',
    id, true, 'sent', gen_random_uuid(), now()
  FROM schools LIMIT 1;

  BEGIN
    UPDATE transactions SET amount = 1.00 WHERE id = v_fake_id;
    RAISE NOTICE 'ERROR: el UPDATE de amount no fue bloqueado';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK: UPDATE de amount bloqueado. Mensaje: %', SQLERRM;
  END;

  DELETE FROM transactions WHERE id = v_fake_id;
  RAISE NOTICE 'TEST 2 COMPLETADO.';
END;
$$;


-- ── TEST 3: Vincular invoice_id (E1) → debe PASAR ──────────────────────────

DO $$
DECLARE
  v_fake_id uuid := gen_random_uuid();
  v_inv_id  uuid := gen_random_uuid();
BEGIN
  INSERT INTO transactions (
    id, type, amount, payment_status, payment_method,
    school_id, is_taxable, billing_status, invoice_id, created_at
  )
  SELECT
    v_fake_id, 'purchase', 200.00, 'paid', 'yape',
    id, true, 'sent', NULL, now()   -- invoice_id IS NULL (huérfana)
  FROM schools LIMIT 1;

  BEGIN
    -- Vincular invoice_id sin tocar campos financieros → debe ser permitido
    UPDATE transactions SET invoice_id = v_inv_id WHERE id = v_fake_id;
    RAISE NOTICE 'OK: Vinculación de invoice_id permitida correctamente (E1).';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ERROR: Vinculación bloqueada incorrectamente. Mensaje: %', SQLERRM;
  END;

  DELETE FROM transactions WHERE id = v_fake_id;
  RAISE NOTICE 'TEST 3 COMPLETADO.';
END;
$$;


-- ── TEST 4: Rescate de huérfana → pending (E2) → debe PASAR ────────────────

DO $$
DECLARE
  v_fake_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO transactions (
    id, type, amount, payment_status, payment_method,
    school_id, is_taxable, billing_status, invoice_id, created_at
  )
  SELECT
    v_fake_id, 'purchase', 75.50, 'paid', 'plin',
    id, true, 'sent', NULL, now()   -- sent SIN invoice_id
  FROM schools LIMIT 1;

  BEGIN
    -- Panel de Rescate resetea a 'pending' → debe ser permitido
    UPDATE transactions SET billing_status = 'pending' WHERE id = v_fake_id;
    RAISE NOTICE 'OK: Rescate de huérfana a "pending" permitido correctamente (E2).';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ERROR: Rescate bloqueado incorrectamente. Mensaje: %', SQLERRM;
  END;

  DELETE FROM transactions WHERE id = v_fake_id;
  RAISE NOTICE 'TEST 4 COMPLETADO.';
END;
$$;


-- ── TEST 5: Cambiar payment_status (e.g., cancelar) → debe FALLAR ──────────

DO $$
DECLARE
  v_fake_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO transactions (
    id, type, amount, payment_status, payment_method,
    school_id, is_taxable, billing_status, invoice_id, created_at
  )
  SELECT
    v_fake_id, 'purchase', 50.00, 'paid', 'transferencia',
    id, true, 'sent', gen_random_uuid(), now()
  FROM schools LIMIT 1;

  BEGIN
    UPDATE transactions SET payment_status = 'cancelled' WHERE id = v_fake_id;
    RAISE NOTICE 'ERROR: cambio de payment_status no bloqueado';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK: Cambio de payment_status bloqueado. Mensaje: %', SQLERRM;
  END;

  DELETE FROM transactions WHERE id = v_fake_id;
  RAISE NOTICE 'TEST 5 COMPLETADO.';
END;
$$;

*/
-- ════════════════════════════════════════════════════════════════════════════════
-- FIN DEL SCRIPT DE VERIFICACIÓN
-- ════════════════════════════════════════════════════════════════════════════════
