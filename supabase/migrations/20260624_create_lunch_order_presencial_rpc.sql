-- ============================================================================
-- RPC: create_lunch_order_presencial
-- Fecha: 2026-06-24
--
-- PROBLEMA RESUELTO:
--   PhysicalOrderWizard hacía 3+ viajes separados a la BD:
--     1. INSERT lunch_orders
--     2. RPC get_next_ticket_number
--     3. INSERT transactions
--   Si el paso 3 tardaba demasiado (pico 8 AM) → statement timeout.
--   La pantalla mostraba "Error" pero el paso 1 YA HABÍA QUEDADO guardado.
--   Resultado: pedidos huérfanos, deudas fantasma, duplicados al reintentar.
--
-- SOLUCIÓN:
--   Un único RPC SECURITY DEFINER que ejecuta TODO dentro de una sola
--   transacción de PostgreSQL. O todo se guarda, o nada se guarda.
--   Imposible que exista lunch_order sin su transaction, ni al revés.
--
-- MODOS DE PAGO CUBIERTOS:
--   'credit'      → Cuenta libre / saldo del alumno (payment_status=pending)
--   'pagar_luego' → Fiado / pagar después (payment_status=pending)
--   'paid'        → Pago inmediato efectivo/yape/tarjeta (payment_status=paid)
--
-- TIPOS DE PERSONA:
--   'student' → alumno (student_id)
--   'teacher' → profesor (teacher_id)
--   'manual'  → nombre manual (manual_name / manual_client_name)
--
-- CASO UPDATE (p_existing_order_id no nulo):
--   Agrega unidades a un pedido ya existente y ajusta la transacción vinculada.
--   Usa SELECT FOR UPDATE para serializar actualizaciones concurrentes.
--
-- BILLING FLAGS (igual que billingUtils.ts):
--   credit / pagar_luego            → is_taxable=false, billing_status='excluded'
--   paid + efectivo/cash/saldo       → is_taxable=false, billing_status='excluded'
--   paid + digital (yape/tarjeta…)   → is_taxable=true,  billing_status='pending'
--
-- IDEMPOTENCIA:
--   Los índices únicos parciales de lunch_orders disparan unique_violation
--   que el RPC captura con prefijo legible ('LUNCH_DUPLICATE').
--
-- TRIGGERS QUE SIGUEN DISPARANDO SIN CAMBIOS:
--   BEFORE INSERT lunch_orders:
--     • trg_validate_lunch_order_deadline (bypass admin)
--     • trg_lunch_orders_prepayment
--   AFTER INSERT transactions:
--     • trg_transactions_balance_sync → sincroniza saldo del alumno
--     • tg_enforce_spending_limit     → bypaseado por metadata.lunch_order_id
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_lunch_order_presencial(
  -- Core order data (todos requeridos — sin DEFAULT)
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
  p_person_type             TEXT,          -- 'student' | 'teacher' | 'manual'
  p_payment_mode            TEXT,          -- 'credit' | 'pagar_luego' | 'paid'
  -- Opcionales (con DEFAULT — deben ir al final en PostgreSQL)
  p_person_id               UUID     DEFAULT NULL,
  p_manual_name             TEXT     DEFAULT NULL,
  p_payment_method          TEXT     DEFAULT NULL,  -- 'efectivo','yape','tarjeta',…
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
  v_order_pm         TEXT;   -- payment_method en lunch_orders
  v_source           TEXT;
  v_new_qty          INT;
  v_new_price        NUMERIC;
  v_existing_tx_id   UUID;
  v_existing_tx_meta JSONB;
  METODOS_EFECTIVO   TEXT[] := ARRAY['efectivo','cash','saldo','pagar_luego','adjustment'];
BEGIN

  -- ── Validar p_person_type ────────────────────────────────────────────────
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

  -- ── Validar p_payment_mode ───────────────────────────────────────────────
  IF p_payment_mode NOT IN ('credit','pagar_luego','paid') THEN
    RAISE EXCEPTION 'PRESENCIAL_INVALID_PAYMENT_MODE: debe ser credit|pagar_luego|paid. Recibido: %', p_payment_mode;
  END IF;

  -- ── Calcular billing flags (espejo exacto de billingUtils.ts) ───────────
  -- paid + método digital → gravado y pendiente de emitir
  IF p_payment_mode = 'paid'
     AND p_payment_method IS NOT NULL
     AND NOT (p_payment_method = ANY(METODOS_EFECTIVO))
  THEN
    v_is_taxable     := TRUE;
    v_billing_status := 'pending';
  END IF;

  v_payment_status := CASE p_payment_mode WHEN 'paid' THEN 'paid' ELSE 'pending' END;

  -- payment_method que se guarda en lunch_orders
  v_order_pm := CASE
    WHEN p_payment_mode = 'paid'        THEN p_payment_method
    WHEN p_payment_mode = 'pagar_luego' THEN 'pagar_luego'
    ELSE NULL   -- credit → sin método explícito en la orden
  END;

  v_source := CASE p_payment_mode
    WHEN 'credit'      THEN 'physical_order_wizard_credit'
    WHEN 'pagar_luego' THEN 'physical_order_wizard_fiado'
    WHEN 'paid'        THEN 'physical_order_wizard_paid'
  END;

  -- ── Generar ticket_code ──────────────────────────────────────────────────
  -- El FOR UPDATE serializa el acceso por usuario dentro de la transacción.
  -- Si falla (tabla no existe, etc.) se continúa sin ticket: nunca bloquea el pedido.
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

  -- ── RAMA A: UPDATE — agregar unidades a pedido existente ────────────────
  IF p_existing_order_id IS NOT NULL THEN

    v_new_qty   := COALESCE(p_existing_order_qty, 1) + p_quantity;
    v_new_price := p_base_price * v_new_qty;

    -- FOR UPDATE serializa actualizaciones concurrentes sobre el mismo pedido
    SELECT id INTO v_order_id
    FROM   public.lunch_orders
    WHERE  id = p_existing_order_id
      AND  is_cancelled = false
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRESENCIAL_ORDER_NOT_FOUND: El pedido % no existe o está cancelado.', p_existing_order_id;
    END IF;

    UPDATE public.lunch_orders
    SET    quantity    = v_new_qty,
           final_price = v_new_price,
           menu_id     = p_menu_id
    WHERE  id = v_order_id;

    -- Buscar y actualizar la transacción pendiente vinculada (si existe)
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

  -- ── RAMA B: INSERT — pedido nuevo ────────────────────────────────────────
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

  -- ── INSERT transacción (mismo ámbito de transacción → atómico) ───────────
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
  'RPC atómica para el wizard presencial de administración. '
  'Crea lunch_order + transaction en una sola transacción de BD para los modos: '
  'credit (cuenta libre), pagar_luego (fiado) y paid (pago inmediato). '
  'Si p_existing_order_id no es nulo, actualiza cantidad y monto en vez de insertar. '
  'Reemplaza el flujo de 3 viajes separados que causaba deudas fantasma y duplicados '
  'por statement timeout en horas punta. Ver migración 20260624.';

REVOKE ALL ON FUNCTION public.create_lunch_order_presencial FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_lunch_order_presencial TO authenticated;

COMMIT;
