-- ============================================================================
-- SOLUCIÓN ARQUITECTURAL: create_lunch_order_v2
-- Fecha: 2026-06-15
--
-- PROBLEMA RAÍZ (diagnosticado):
--   1. fn_sync_student_balance hace SELECT SUM(amount) FROM transactions WHERE
--      student_id=X AND is_deleted=false AND payment_status='pending'.
--      No existe índice que cubra exactamente esta query → barrido lento.
--      Bajo carga de 8 AM (muchos padres al mismo tiempo), el advisory lock se
--      sostiene más tiempo → contención → statement timeout.
--
--   2. La creación del pedido era no-atómica: 3 viajes separados del frontend
--      (INSERT lunch_orders → RPC ticket → INSERT transactions).
--      Si el paso 3 fallaba, el "deshacer" manual también podía fallar
--      → pedido huérfano sin deuda.
--
-- SOLUCIÓN:
--   A) Índice cubriente para fn_sync_student_balance (fix de performance).
--   B) RPC atómica create_lunch_order_v2 (fix arquitectural).
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE A — Índice cubriente para fn_sync_student_balance
-- ============================================================================
-- La función fn_sync_student_balance ejecuta:
--   SELECT COALESCE(SUM(t.amount), 0) FROM transactions t
--   WHERE t.student_id = X AND t.is_deleted = false AND t.payment_status = 'pending'
--
-- Con este índice PostgreSQL hace index-only scan: obtiene student_id + payment_status
-- + amount directamente del índice sin tocar el heap → microsegundos, no segundos.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_balance_sync_covering
  ON public.transactions (student_id, payment_status)
  INCLUDE (amount)
  WHERE is_deleted = false;

COMMENT ON INDEX public.idx_transactions_balance_sync_covering IS
  'Índice cubriente para fn_sync_student_balance. Cubre la query SUM de deuda '
  'pendiente por alumno sin filtro de tipo. Index-only scan elimina el barrido '
  'lento que causaba statement timeout bajo carga de 8 AM.';

-- ============================================================================
-- PARTE B — RPC atómica create_lunch_order_v2
-- ============================================================================
-- Reemplaza el flujo de 3 viajes del frontend con una sola transacción de BD.
-- Garantías:
--   - Atómica: si falla cualquier paso, ambos inserts se revierten automáticamente.
--   - Sin huérfanos: imposible que exista lunch_order sin transaction asociada.
--   - Los triggers existentes se respetan íntegramente:
--     * trg_validate_lunch_order_deadline (BEFORE INSERT en lunch_orders)
--     * trg_lunch_orders_prepayment       (BEFORE INSERT en lunch_orders)
--     * trg_enforce_spending_limit        (BEFORE INSERT en transactions — bypass por lunch)
--     * trg_transactions_balance_sync     (AFTER INSERT en transactions)
--     * trg_sync_period_spent             (AFTER INSERT en transactions — bypass por lunch)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_lunch_order_v2(
  p_person_type             TEXT,        -- 'student' | 'teacher'
  p_person_id               UUID,        -- student_id o teacher_id según p_person_type
  p_order_date              DATE,
  p_category_id             UUID,
  p_menu_id                 UUID,
  p_school_id               UUID,
  p_quantity                INT,
  p_base_price              NUMERIC,
  p_final_price             NUMERIC,
  p_created_by              UUID,        -- usuario que realiza la acción
  p_source                  TEXT,        -- ej: 'unified_calendar_v2_parent'
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
  -- ── Validar p_person_type ────────────────────────────────────────────────
  IF p_person_type = 'student' THEN
    v_student_id := p_person_id;
  ELSIF p_person_type = 'teacher' THEN
    v_teacher_id := p_person_id;
  ELSE
    RAISE EXCEPTION 'CREATE_LUNCH_ORDER_INVALID_PERSON_TYPE: p_person_type debe ser ''student'' o ''teacher''. Recibido: %', p_person_type;
  END IF;

  -- ── Generar ticket_code ──────────────────────────────────────────────────
  -- FOR UPDATE serializa el acceso por usuario. Sin advisory lock adicional:
  -- dentro de una transacción el FOR UPDATE es suficiente para unicidad.
  -- El ticket es informativo: si falla, el pedido igual se crea (ticket NULL).
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
  -- BILLING_EXCLUDED: is_taxable=FALSE, billing_status='excluded'
  -- metadata.lunch_order_id activa bypass del tope de kiosco en el trigger.
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
  'Reemplaza el flujo de 3 viajes del frontend que causaba pedidos huérfanos y '
  'timeouts. Ver migración 20260615 para contexto completo.';

REVOKE ALL ON FUNCTION public.create_lunch_order_v2 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lunch_order_v2 TO authenticated;

COMMIT;
