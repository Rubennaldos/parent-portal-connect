-- ============================================================================
-- FIX: Pedidos presenciales (caja/admin) nunca deben nacer congelados
-- Fecha: 2026-07-13
--
-- PROBLEMA CONFIRMADO (caso Lesly Asca 2026-07-13):
--   1. Wizard "Sin Crédito" guardaba person_type=manual (sin teacher_id).
--   2. Sede con force_prepayment=true + rol cajero/gestor (sin bypass)
--      → trg_lunch_orders_prepayment marcaba frozen_pending_payment.
--   3. create_lunch_order_presencial insertaba la tx ya en payment_status=paid.
--   4. El promote original solo escuchaba UPDATE de payment_status, no INSERT.
--      Resultado: pedido PAGADO pero invisible en Gestión de Pedidos
--      (is_active_unified=false porque teacher_id IS NULL y sigue frozen).
--
-- SOLUCIÓN (SSOT en DB, sin parches en React):
--   A) Expandir bypass de prepago a roles operativos de sede/caja.
--   B) create_lunch_order_presencial fuerza confirmed_paid tras INSERT
--      (este RPC es SOLO presencial staff → nunca es flujo Izipay/prepago padre).
--   C) Reafirmar trigger promote en INSERT OR UPDATE (idempotente).
--   D) Reparar pedidos existentes congelados que ya tienen cobro presencial.
--   E) Anular deudas fantasma prepago_congelado duplicadas cuando ya hay tx paid.
--
-- NO TOCA: Izipay, webhooks, apply_gateway_credit, fn_sync_student_balance.
-- IDEMPOTENCIA: updates filtrados por estado; promote ya es idempotente.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) Staff operativo NUNCA congela pedidos (prepago es para padres/pasarela)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_prepayment_logic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role    TEXT;
  v_school_id      UUID;
  v_force_prepay   BOOLEAN := false;
BEGIN
  SELECT role
    INTO v_caller_role
    FROM public.profiles
   WHERE id = auth.uid();

  -- Bypass: roles administrativos Y operativos de sede/caja/cocina.
  -- El modo prepago (frozen) es exclusivo del portal de padres / pasarela.
  -- Pedidos creados por staff en caja o calendario administrativo deben
  -- aparecer inmediatamente en Gestión de Pedidos y cocina.
  IF v_caller_role IN (
    'admin_general',
    'superadmin',
    'admin_sede',
    'gestor_unidad',
    'operador_caja',
    'cajero',
    'operador_cocina',
    'supervisor_red'
  ) THEN
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
  END IF;

  v_school_id := NEW.school_id;

  IF v_school_id IS NULL AND NEW.student_id IS NOT NULL THEN
    SELECT school_id
      INTO v_school_id
      FROM public.students
     WHERE id = NEW.student_id;
  END IF;

  IF v_school_id IS NULL AND NEW.teacher_id IS NOT NULL THEN
    SELECT school_id_1
      INTO v_school_id
      FROM public.teacher_profiles
     WHERE id = NEW.teacher_id;
  END IF;

  IF v_school_id IS NULL THEN
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
  END IF;

  SELECT COALESCE(force_prepayment, false)
    INTO v_force_prepay
    FROM public.lunch_configuration
   WHERE school_id = v_school_id
   LIMIT 1;

  IF NOT FOUND THEN
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
  END IF;

  IF v_force_prepay THEN
    NEW.payment_flow_state := 'frozen_pending_payment'::public.lunch_order_payment_state;
  ELSE
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
  END IF;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'fn_handle_prepayment_logic: excepción capturada (%) — fallback a confirmed_paid para school_id=%',
      SQLERRM, v_school_id;
    NEW.payment_flow_state := 'confirmed_paid'::public.lunch_order_payment_state;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_handle_prepayment_logic() IS
  'BEFORE INSERT lunch_orders: asigna payment_flow_state. '
  'Bypass confirmed_paid para staff (admin/gestor/caja/cocina). '
  'frozen_pending_payment solo aplica a padres cuando force_prepayment=true.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B) RPC presencial: blindaje — siempre confirmed_paid tras crear el pedido
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_lunch_order_presencial(
  p_school_id               UUID,
  p_menu_id                 UUID,
  p_order_date              DATE,
  p_category_id             UUID,
  p_category_name           TEXT,
  p_base_price              NUMERIC,
  p_final_price             NUMERIC,
  p_quantity                INT,
  p_created_by              UUID,
  p_description             TEXT,
  p_person_type             TEXT,
  p_payment_mode            TEXT,
  p_person_id               UUID     DEFAULT NULL,
  p_manual_name             TEXT     DEFAULT NULL,
  p_payment_method          TEXT     DEFAULT NULL,
  p_operation_number        TEXT     DEFAULT NULL,
  p_payment_details         JSONB    DEFAULT NULL,
  p_selected_modifiers      JSONB    DEFAULT NULL,
  p_selected_garnishes      JSONB    DEFAULT NULL,
  p_configurable_selections JSONB    DEFAULT NULL,
  p_existing_order_id       UUID     DEFAULT NULL,
  p_existing_order_qty      INT      DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order_id         UUID;
  v_tx_id            UUID;
  v_ticket_code      TEXT    := NULL;
  v_prefix           TEXT;
  v_ticket_num       INT;
  v_student_id       UUID    := NULL;
  v_teacher_id       UUID    := NULL;
  v_is_taxable       BOOLEAN := FALSE;
  v_billing_status   TEXT    := 'excluded';
  v_payment_status   TEXT;
  v_order_pm         TEXT;
  v_source           TEXT;
  v_new_qty          INT;
  v_new_price        NUMERIC;
  v_existing_tx_id   UUID;
  v_existing_tx_meta JSONB;
  METODOS_EFECTIVO   TEXT[] := ARRAY['efectivo','cash','saldo','pagar_luego','adjustment'];
BEGIN

  IF p_person_type = 'student' THEN
    v_student_id := p_person_id;
  ELSIF p_person_type = 'teacher' THEN
    v_teacher_id := p_person_id;
  ELSIF p_person_type = 'manual' THEN
    IF p_manual_name IS NULL OR trim(p_manual_name) = '' THEN
      RAISE EXCEPTION 'PRESENCIAL_INVALID_MANUAL: p_manual_name es requerido para person_type=manual.';
    END IF;
  ELSE
    RAISE EXCEPTION 'PRESENCIAL_INVALID_PERSON_TYPE: debe ser student|teacher|manual. Recibido: %', p_person_type;
  END IF;

  IF p_payment_mode NOT IN ('credit','pagar_luego','paid') THEN
    RAISE EXCEPTION 'PRESENCIAL_INVALID_PAYMENT_MODE: debe ser credit|pagar_luego|paid. Recibido: %', p_payment_mode;
  END IF;

  -- student/teacher requieren person_id (evita pedidos huérfanos sin vínculo)
  IF p_person_type IN ('student', 'teacher') AND p_person_id IS NULL THEN
    RAISE EXCEPTION 'PRESENCIAL_MISSING_PERSON_ID: p_person_id es requerido para person_type=%', p_person_type;
  END IF;

  IF p_payment_mode = 'paid'
     AND p_payment_method IS NOT NULL
     AND NOT (p_payment_method = ANY(METODOS_EFECTIVO))
  THEN
    v_is_taxable     := TRUE;
    v_billing_status := 'pending';
  END IF;

  v_payment_status := CASE p_payment_mode WHEN 'paid' THEN 'paid' ELSE 'pending' END;

  v_order_pm := CASE
    WHEN p_payment_mode = 'paid'        THEN p_payment_method
    WHEN p_payment_mode = 'pagar_luego' THEN 'pagar_luego'
    ELSE NULL
  END;

  v_source := CASE p_payment_mode
    WHEN 'credit'      THEN 'physical_order_wizard_credit'
    WHEN 'pagar_luego' THEN 'physical_order_wizard_fiado'
    WHEN 'paid'        THEN 'physical_order_wizard_paid'
  END;

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

  -- ── RAMA A: UPDATE ───────────────────────────────────────────────────────
  IF p_existing_order_id IS NOT NULL THEN

    v_new_qty   := COALESCE(p_existing_order_qty, 1) + p_quantity;
    v_new_price := p_base_price * v_new_qty;

    SELECT id INTO v_order_id
    FROM   public.lunch_orders
    WHERE  id = p_existing_order_id
      AND  is_cancelled = false
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRESENCIAL_ORDER_NOT_FOUND: El pedido % no existe o está cancelado.', p_existing_order_id;
    END IF;

    UPDATE public.lunch_orders
    SET    quantity           = v_new_qty,
           final_price        = v_new_price,
           menu_id            = p_menu_id,
           payment_flow_state = 'confirmed_paid'::public.lunch_order_payment_state
    WHERE  id = v_order_id;

    SELECT id, metadata
    INTO   v_existing_tx_id, v_existing_tx_meta
    FROM   public.transactions
    WHERE  (metadata->>'lunch_order_id') = v_order_id::TEXT
      AND  is_deleted = false
      AND  payment_status IN ('pending','partial')
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.transactions
      SET    amount      = -ABS(v_new_price),
             description = p_description,
             metadata    = v_existing_tx_meta
                           || jsonb_build_object(
                                'quantity',   v_new_qty,
                                'updated_at', to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                              )
      WHERE  id = v_existing_tx_id;
      v_tx_id := v_existing_tx_id;
    END IF;

    RETURN jsonb_build_object(
      'lunch_order_id', v_order_id,
      'transaction_id', v_tx_id,
      'ticket_code',    v_ticket_code,
      'is_update',      true,
      'new_quantity',   v_new_qty
    );
  END IF;

  -- ── RAMA B: INSERT ───────────────────────────────────────────────────────
  BEGIN
    INSERT INTO public.lunch_orders (
      student_id, teacher_id, manual_name,
      order_date, status,
      category_id, menu_id, school_id,
      quantity, base_price, addons_total, final_price,
      created_by, payment_method, payment_details,
      selected_modifiers, selected_garnishes, configurable_selections
    )
    VALUES (
      v_student_id, v_teacher_id, p_manual_name,
      p_order_date, 'confirmed',
      p_category_id, p_menu_id, p_school_id,
      p_quantity, p_base_price, 0, p_final_price,
      p_created_by, v_order_pm,
      CASE WHEN p_payment_mode = 'paid' THEN COALESCE(p_payment_details, '{}'::jsonb) ELSE NULL END,
      p_selected_modifiers, p_selected_garnishes, p_configurable_selections
    )
    RETURNING id INTO v_order_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'LUNCH_DUPLICATE: Ya existe un pedido activo para esta persona, categoría y fecha.';
  END;

  -- Blindaje SSOT: este RPC es presencial staff → NUNCA queda frozen.
  -- Cubre carrera con trg_lunch_orders_prepayment / trg_materialize_frozen.
  UPDATE public.lunch_orders
  SET    payment_flow_state = 'confirmed_paid'::public.lunch_order_payment_state
  WHERE  id = v_order_id
    AND  payment_flow_state IS DISTINCT FROM 'confirmed_paid'::public.lunch_order_payment_state;

  -- Si el AFTER INSERT materializó una deuda fantasma prepago, anularla:
  -- la tx real del wizard se inserta a continuación.
  UPDATE public.transactions
  SET    is_deleted     = true,
         payment_status = 'cancelled',
         metadata       = COALESCE(metadata, '{}'::jsonb)
                          || jsonb_build_object(
                               'void_reason', 'presencial_wizard_supersedes_frozen_materialization',
                               'voided_at_lima', timezone('America/Lima', now())::text
                             )
  WHERE  (metadata->>'lunch_order_id') = v_order_id::TEXT
    AND  COALESCE(is_deleted, false) = false
    AND  payment_status = 'pending'
    AND  payment_method = 'prepago_congelado'
    AND  metadata->>'source' = 'trg_materialize_frozen_lunch';

  INSERT INTO public.transactions (
    student_id, teacher_id, manual_client_name,
    type, amount, description,
    payment_status, payment_method,
    school_id, created_by, ticket_code,
    operation_number,
    is_taxable, billing_status,
    metadata
  )
  VALUES (
    v_student_id,
    v_teacher_id,
    CASE WHEN p_person_type = 'manual' THEN p_manual_name ELSE NULL END,
    'purchase',
    -ABS(p_final_price),
    p_description,
    v_payment_status,
    CASE WHEN p_payment_mode = 'paid' THEN p_payment_method ELSE NULL END,
    p_school_id,
    p_created_by,
    v_ticket_code,
    p_operation_number,
    v_is_taxable,
    v_billing_status,
    jsonb_build_object(
      'lunch_order_id', v_order_id,
      'source',         v_source,
      'order_date',     p_order_date::TEXT,
      'category_name',  p_category_name,
      'quantity',       p_quantity,
      'payment_details', COALESCE(p_payment_details, '{}'::jsonb)
    )
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'lunch_order_id', v_order_id,
    'transaction_id', v_tx_id,
    'ticket_code',    v_ticket_code,
    'is_update',      false
  );

END;
$fn$;

COMMENT ON FUNCTION public.create_lunch_order_presencial IS
  'RPC atómica presencial (caja/admin). Crea lunch_order + transaction. '
  'Garantiza payment_flow_state=confirmed_paid (nunca frozen). '
  'Soporta student|teacher|manual + credit|pagar_luego|paid. Idempotente vía índices únicos.';

REVOKE ALL ON FUNCTION public.create_lunch_order_presencial FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_lunch_order_presencial TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C) Promote: INSERT paid también descongela (refuerzo del hotfix 20260521)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_transactions_promote_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lunch_order_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.payment_status IS NOT DISTINCT FROM 'paid' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;

  IF NEW.metadata IS NULL OR (NEW.metadata->>'lunch_order_id') IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_lunch_order_id := (NEW.metadata->>'lunch_order_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_fn_transactions_promote_frozen: metadata->lunch_order_id invalido. tx_id=%. Valor=%',
      NEW.id, NEW.metadata->>'lunch_order_id';
    RETURN NEW;
  END;

  PERFORM public.fn_promote_frozen_order(
    v_lunch_order_id,
    'transactions',
    NEW.id,
    NEW.school_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_promote_frozen ON public.transactions;

CREATE TRIGGER trg_transactions_promote_frozen
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_transactions_promote_frozen();

COMMENT ON TRIGGER trg_transactions_promote_frozen ON public.transactions IS
  'Promueve lunch_order frozen→confirmed_paid en INSERT paid y UPDATE→paid. Idempotente.';

-- ─────────────────────────────────────────────────────────────────────────────
-- D + auditoría) Reparación atómica: descongelar + auditar (sin TEMP TABLE)
--     Supabase SQL Editor no garantiza tablas temporales entre sentencias.
-- ─────────────────────────────────────────────────────────────────────────────
WITH candidatos AS (
  SELECT
    lo.id,
    lo.school_id,
    lo.manual_name,
    lo.teacher_id,
    lo.student_id,
    lo.payment_method,
    lo.order_date
  FROM public.lunch_orders lo
  WHERE lo.is_cancelled = false
    AND lo.payment_flow_state = 'frozen_pending_payment'::public.lunch_order_payment_state
    AND (
      COALESCE(lo.payment_method, '') IN ('efectivo', 'tarjeta', 'yape', 'transferencia', 'cash')
      OR EXISTS (
        SELECT 1
        FROM public.transactions t
        WHERE COALESCE(t.is_deleted, false) = false
          AND t.payment_status = 'paid'
          AND (t.metadata->>'lunch_order_id') = lo.id::TEXT
      )
      OR EXISTS (
        SELECT 1
        FROM public.transactions t
        WHERE COALESCE(t.is_deleted, false) = false
          AND (t.metadata->>'lunch_order_id') = lo.id::TEXT
          AND (t.metadata->>'source') LIKE 'physical_order_wizard_%'
      )
    )
),
descongelados AS (
  UPDATE public.lunch_orders lo
  SET payment_flow_state = 'confirmed_paid'::public.lunch_order_payment_state
  FROM candidatos c
  WHERE lo.id = c.id
  RETURNING
    lo.id,
    lo.school_id,
    lo.manual_name,
    lo.teacher_id,
    lo.student_id,
    lo.payment_method,
    lo.order_date
)
INSERT INTO public.audit_billing_logs (
  action_type,
  record_id,
  table_name,
  changed_by_user_id,
  school_id,
  new_data
)
SELECT
  'REPAIR_PRESENCIAL_UNFREEZE',
  d.id,
  'lunch_orders',
  NULL,
  d.school_id,
  jsonb_build_object(
    'manual_name', d.manual_name,
    'teacher_id', d.teacher_id,
    'student_id', d.student_id,
    'payment_method', d.payment_method,
    'order_date', d.order_date,
    'ts_lima', timezone('America/Lima', now()),
    'nota', 'Pedido presencial descongelado por migración 20260713'
  )
FROM descongelados d;

-- E) Anular deudas fantasma prepago cuando ya existe cobro/tx real del wizard
UPDATE public.transactions t_ghost
SET    is_deleted     = true,
       payment_status = 'cancelled',
       metadata       = COALESCE(t_ghost.metadata, '{}'::jsonb)
                        || jsonb_build_object(
                             'void_reason', 'repair_20260713_duplicate_frozen_materialization',
                             'voided_at_lima', timezone('America/Lima', now())::text
                           )
WHERE  COALESCE(t_ghost.is_deleted, false) = false
  AND  t_ghost.payment_status = 'pending'
  AND  t_ghost.payment_method = 'prepago_congelado'
  AND  t_ghost.metadata->>'source' = 'trg_materialize_frozen_lunch'
  AND  EXISTS (
    SELECT 1
    FROM   public.transactions t_real
    WHERE  COALESCE(t_real.is_deleted, false) = false
      AND  (t_real.metadata->>'lunch_order_id') = (t_ghost.metadata->>'lunch_order_id')
      AND  t_real.id <> t_ghost.id
      AND  (
        t_real.payment_status = 'paid'
        OR (t_real.metadata->>'source') LIKE 'physical_order_wizard_%'
      )
  );

COMMIT;

SELECT '20260713_fix_presencial_orders_never_frozen ✅ aplicado' AS resultado;
