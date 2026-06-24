-- ============================================================================
-- PARCHE: create_lunch_order_v2 — lock_timeout + statement_timeout
-- Fecha: 2026-06-24
--
-- PROBLEMA:
--   create_lunch_orders_batch_v2 y create_and_deliver_lunch_order ya tienen
--   timeouts defensivos (migración 20260618_c). La RPC individual
--   create_lunch_order_v2 (botón "Pedir" del wizard de padres) no los tenía.
--   Sin lock_timeout, si fn_sync_student_balance no puede adquirir el
--   advisory lock en 8 AM, la conexión se cuelga indefinidamente consumiendo
--   una ranura del pool de pgBouncer → efecto cascada → más timeouts.
--
-- SOLUCIÓN:
--   SET LOCAL lock_timeout = '4s':
--     Si no se puede adquirir el lock en 4s → falla rápido con error legible.
--     La conexión se libera inmediatamente → pool sano.
--   SET LOCAL statement_timeout = '20s':
--     Red de seguridad: si la función completa supera 20s por cualquier motivo,
--     Postgres la cancela y libera todos los locks y la conexión.
--
-- Estos valores son idénticos a los usados en las otras RPCs de almuerzo.
-- SET LOCAL scope = transacción actual → sin efecto secundario global.
--
-- NO se modifica ninguna lógica financiera, de auditoría ni de idempotencia.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_lunch_order_v2(
  p_person_type             TEXT,
  p_person_id               UUID,
  p_order_date              DATE,
  p_category_id             UUID,
  p_menu_id                 UUID,
  p_school_id               UUID,
  p_quantity                INT,
  p_base_price              NUMERIC,
  p_final_price             NUMERIC,
  p_created_by              UUID,
  p_source                  TEXT,
  p_category_name           TEXT,
  p_description             TEXT,
  p_selected_modifiers      JSONB    DEFAULT NULL,
  p_selected_garnishes      JSONB    DEFAULT NULL,
  p_configurable_selections JSONB    DEFAULT NULL,
  p_parent_notes            TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order_id            UUID;
  v_tx_id               UUID;
  v_payment_flow_state  TEXT;
  v_ticket_code         TEXT    := NULL;
  v_prefix              TEXT;
  v_ticket_num          INT;
  v_student_id          UUID    := NULL;
  v_teacher_id          UUID    := NULL;
BEGIN
  -- ── Timeouts defensivos (igual que create_and_deliver_lunch_order y batch_v2) ──
  -- lock_timeout: si fn_sync_student_balance no puede adquirir el advisory lock
  -- en 4s (pico 8 AM con muchos padres) → falla rápido en vez de colgar el pool.
  -- statement_timeout: límite absoluto por llamada. Nunca debería alcanzarse.
  SET LOCAL lock_timeout      = '4s';
  SET LOCAL statement_timeout = '20s';

  -- ── Validar p_person_type ────────────────────────────────────────────────
  IF p_person_type = 'student' THEN
    v_student_id := p_person_id;
  ELSIF p_person_type = 'teacher' THEN
    v_teacher_id := p_person_id;
  ELSE
    RAISE EXCEPTION 'CREATE_LUNCH_ORDER_INVALID_PERSON_TYPE: p_person_type debe ser ''student'' o ''teacher''. Recibido: %', p_person_type;
  END IF;

  -- ── Generar ticket_code ──────────────────────────────────────────────────
  BEGIN
    SELECT prefix, current_number
    INTO   v_prefix, v_ticket_num
    FROM   public.ticket_sequences
    WHERE  profile_id = p_created_by
    FOR UPDATE;

    IF NOT FOUND THEN
      v_prefix := public.generate_user_prefix(p_created_by);
      INSERT INTO public.ticket_sequences (profile_id, current_number, prefix)
      VALUES (p_created_by, 1, v_prefix)
      ON CONFLICT (profile_id) DO UPDATE
        SET current_number = ticket_sequences.current_number + 1,
            updated_at     = NOW()
      RETURNING current_number INTO v_ticket_num;
    ELSE
      UPDATE public.ticket_sequences
      SET    current_number = current_number + 1,
             updated_at     = NOW()
      WHERE  profile_id = p_created_by
      RETURNING current_number INTO v_ticket_num;
    END IF;

    v_ticket_code := v_prefix || LPAD(v_ticket_num::TEXT, 6, '0');
  EXCEPTION WHEN OTHERS THEN
    v_ticket_code := NULL;
  END;

  -- ── 1. Insertar en lunch_orders ──────────────────────────────────────────
  BEGIN
    INSERT INTO public.lunch_orders (
      student_id,
      teacher_id,
      order_date,
      status,
      category_id,
      menu_id,
      school_id,
      quantity,
      base_price,
      addons_total,
      final_price,
      created_by,
      selected_modifiers,
      selected_garnishes,
      configurable_selections,
      parent_notes
    )
    VALUES (
      v_student_id,
      v_teacher_id,
      p_order_date,
      'pending',
      p_category_id,
      p_menu_id,
      p_school_id,
      p_quantity,
      p_base_price,
      0,
      p_final_price,
      p_created_by,
      p_selected_modifiers,
      p_selected_garnishes,
      p_configurable_selections,
      p_parent_notes
    )
    RETURNING id, payment_flow_state::TEXT
    INTO      v_order_id, v_payment_flow_state;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'LUNCH_DUPLICATE: Ya existe un pedido activo para esta categoría en este día.';
  END;

  -- ── 2. Insertar en transactions (deuda pendiente) ────────────────────────
  INSERT INTO public.transactions (
    student_id,
    teacher_id,
    type,
    amount,
    description,
    payment_status,
    payment_method,
    school_id,
    created_by,
    ticket_code,
    is_taxable,
    billing_status,
    metadata
  )
  VALUES (
    v_student_id,
    v_teacher_id,
    'purchase',
    -ABS(p_final_price),
    p_description,
    'pending',
    NULL,
    p_school_id,
    p_created_by,
    v_ticket_code,
    FALSE,
    'excluded',
    jsonb_build_object(
      'lunch_order_id', v_order_id,
      'source',         p_source,
      'order_date',     p_order_date::TEXT,
      'category_name',  p_category_name,
      'quantity',       p_quantity
    )
  )
  RETURNING id INTO v_tx_id;

  -- ── Resultado ─────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'lunch_order_id',     v_order_id,
    'transaction_id',     v_tx_id,
    'ticket_code',        v_ticket_code,
    'payment_flow_state', v_payment_flow_state
  );
END;
$fn$;

COMMENT ON FUNCTION public.create_lunch_order_v2 IS
  'RPC atómica: crea lunch_order + transaction de deuda en una sola transacción. '
  'lock_timeout=4s, statement_timeout=20s (igual que batch_v2 y create_and_deliver). '
  'Reemplaza el flujo de 3 viajes del frontend que causaba pedidos huérfanos y '
  'timeouts. Ver migraciones 20260615 y 20260624_b para contexto completo.';

REVOKE ALL ON FUNCTION public.create_lunch_order_v2 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lunch_order_v2 TO authenticated;

COMMIT;

SELECT 'create_lunch_order_v2 — timeouts añadidos ✅' AS resultado;
