-- ============================================================================
-- MIGRACIÓN: void_pending_debt_from_billing
-- Fecha: 2026-06-25
--
-- PROPÓSITO:
--   Habilitar la anulación de deudas pendientes (payment_status = 'pending' |
--   'partial') directamente desde el módulo de Cobranzas, sin necesidad de
--   navegar al módulo de Almuerzos o al módulo de Ventas.
--
--   Cubre todos los perfiles de deuda:
--     · Almuerzo de alumno   (student_id + metadata.lunch_order_id)
--     · Almuerzo de profesor (teacher_id + metadata.lunch_order_id)
--     · Venta kiosco/POS     (sin lunch_order_id)
--   Funciona igual para alumnos, profesores y clientes manuales.
--
-- CONTRATOS GARANTIZADOS:
--   ① Nunca DELETE — solo payment_status → 'cancelled'
--   ② Auditoría obligatoria en audit_billing_logs + huella_digital_logs
--   ③ FOR UPDATE previene doble anulación concurrente
--   ④ SUNAT: si billing_status = 'sent' → bloqueo directo (usar NC)
--   ⑤ Motivo mínimo 15 caracteres — validado en SQL, no en el frontend
--   ⑥ admin_sede / gestor_unidad: solo su sede; admin_general / superadmin: bypass
--   ⑦ El trigger trg_transactions_balance_sync recalcula el saldo automáticamente
--      al cambiar payment_status — este RPC nunca toca saldo directamente
--   ⑧ Deudas virtuales (is_kiosk_balance_debt, IDs tipo 'kiosk_balance_*')
--      son rechazadas — esas se anulan por sus transacciones reales
--
-- ROLES AUTORIZADOS:
--   superadmin, admin_general                         — bypass total de sede y horario
--   admin_sede, gestor_unidad                         — solo su sede
--
-- RESPUESTA:
--   { success, transaction_id, debt_type, lunch_order_cancelled, voucher_voided }
--
-- PREFIJOS DE ERROR LEGIBLES POR EL FRONTEND:
--   REASON_REQUIRED     — motivo vacío o menor a 15 caracteres
--   UNAUTHORIZED        — no autenticado o token inválido
--   FORBIDDEN_ROLE      — rol no autorizado
--   FORBIDDEN_SCHOOL    — admin_sede intentando anular de otra sede
--   NOT_FOUND           — transacción inexistente o ya eliminada lógicamente
--   INVALID_TYPE        — la transacción no es de tipo 'purchase'
--   INVALID_STATUS      — no está en pending / partial
--   ALREADY_CANCELLED   — ya fue anulada (respuesta idempotente)
--   SUNAT_INTEGRITY     — tiene comprobante enviado a SUNAT (usar Nota de Crédito)
--   VIRTUAL_DEBT        — deuda virtual agregada, no anulable por este RPC
-- ============================================================================

-- ── Guard de prerrequisitos ───────────────────────────────────────────────────
-- Si falla aquí: estás en el proyecto Supabase incorrecto o la tabla aún no existe.
DO $guard$
BEGIN
  IF to_regclass('public.transactions') IS NULL THEN
    RAISE EXCEPTION
      'PREREQUISITE_MISSING: public.transactions no existe en esta base de datos. '
      'Ejecute este SQL en el proyecto Supabase de producción (Dashboard → SQL Editor).';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION
      'PREREQUISITE_MISSING: public.profiles no existe en esta base de datos.';
  END IF;
  IF to_regclass('public.audit_billing_logs') IS NULL THEN
    RAISE EXCEPTION
      'PREREQUISITE_MISSING: public.audit_billing_logs no existe en esta base de datos.';
  END IF;
END;
$guard$;

DROP FUNCTION IF EXISTS public.void_pending_debt_from_billing(uuid, text);

CREATE OR REPLACE FUNCTION public.void_pending_debt_from_billing(
  p_transaction_id  uuid,
  p_reason          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor_id        uuid;
  v_actor_role      text;
  v_actor_school_id uuid;
  v_tx              public.transactions%ROWTYPE;
  v_lunch_order_id  uuid;
  v_lo_school_id    uuid;
  v_lo_cancelled    boolean;
  v_rr_id           uuid;
  v_debt_type       text;
  v_lunch_cancelled boolean := false;
  v_voucher_voided  boolean := false;
  v_now_lima        timestamptz;
BEGIN

  -- ── 1. Validar motivo ANTES de tocar la BD ──────────────────────────────
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 15 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: El motivo es obligatorio y debe tener al menos 15 caracteres.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 2. Autenticación ──────────────────────────────────────────────────────
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Usuario no autenticado.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 3. Autorización por rol ───────────────────────────────────────────────
  SELECT p.role, p.school_id
    INTO v_actor_role, v_actor_school_id
  FROM   public.profiles p
  WHERE  p.id = v_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN (
    'superadmin', 'admin_general', 'admin_sede', 'gestor_unidad'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: El rol % no está autorizado para anular deudas.', COALESCE(v_actor_role, 'sin_rol')
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 4. Bloqueo optimista + lectura de la transacción ─────────────────────
  SELECT *
    INTO v_tx
  FROM   public.transactions
  WHERE  id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: La transacción % no existe.', p_transaction_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 5. Validaciones de estado ─────────────────────────────────────────────

  IF COALESCE(v_tx.is_deleted, false) THEN
    RAISE EXCEPTION 'NOT_FOUND: La transacción está eliminada lógicamente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.type <> 'purchase' THEN
    RAISE EXCEPTION 'INVALID_TYPE: Solo se pueden anular transacciones de tipo compra (purchase). Esta es de tipo %.', v_tx.type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.payment_status = 'cancelled' THEN
    RAISE EXCEPTION 'ALREADY_CANCELLED: La deuda ya fue anulada anteriormente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.payment_status NOT IN ('pending', 'partial') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Solo se pueden anular deudas en estado pending o partial. Estado actual: %.', v_tx.payment_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tx.billing_status = 'sent' THEN
    RAISE EXCEPTION 'SUNAT_INTEGRITY: Esta deuda tiene un comprobante enviado a SUNAT. Debe emitir una Nota de Crédito desde el módulo de Facturación.'
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_tx.metadata->>'is_kiosk_balance_debt', 'false')::boolean THEN
    RAISE EXCEPTION 'VIRTUAL_DEBT: Las deudas de saldo negativo de kiosco se anulan por cada consumo individual, no de forma agregada.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 6. Control de sede para roles no globales ─────────────────────────────
  IF v_actor_role IN ('admin_sede', 'gestor_unidad') THEN
    IF v_tx.school_id IS DISTINCT FROM v_actor_school_id THEN
      RAISE EXCEPTION 'FORBIDDEN_SCHOOL: No tiene permiso para anular deudas de otra sede.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 7. Determinar tipo de deuda ───────────────────────────────────────────
  v_now_lima       := timezone('America/Lima', now());
  v_lunch_order_id := (v_tx.metadata->>'lunch_order_id')::uuid;

  IF v_lunch_order_id IS NOT NULL THEN
    v_debt_type := 'lunch';
  ELSE
    v_debt_type := 'other';
  END IF;

  -- ── 8. Cancelar la transacción ──────────────────────────────────────────
  UPDATE public.transactions
  SET
    payment_status = 'cancelled',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by',        v_actor_id::text,
      'cancelled_at',        to_char(v_now_lima, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'cancellation_reason', TRIM(p_reason),
      'void_source',         'void_pending_debt_from_billing',
      'void_role',           v_actor_role
    )
  WHERE id = p_transaction_id
    AND payment_status <> 'cancelled';

  -- ── 9. Si es almuerzo: cancelar lunch_order + voucher pending ───────────
  IF v_lunch_order_id IS NOT NULL THEN

    SELECT school_id, is_cancelled
      INTO v_lo_school_id, v_lo_cancelled
    FROM   public.lunch_orders
    WHERE  id = v_lunch_order_id
    FOR UPDATE;

    IF FOUND AND NOT v_lo_cancelled THEN
      UPDATE public.lunch_orders
      SET
        is_cancelled        = true,
        status              = 'cancelled',
        cancelled_by        = v_actor_id,
        cancelled_at        = v_now_lima,
        cancellation_reason = TRIM(p_reason) || ' [anulado desde Cobranzas por ' || v_actor_role || ']'
      WHERE id = v_lunch_order_id;

      v_lunch_cancelled := true;
    END IF;

    SELECT id
      INTO v_rr_id
    FROM   public.recharge_requests
    WHERE  v_lunch_order_id = ANY(COALESCE(lunch_order_ids, '{}'))
      AND  status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.recharge_requests
      SET
        status      = 'voided',
        voided_by   = v_actor_id,
        voided_at   = v_now_lima,
        void_reason = 'Anulado desde Cobranzas por admin — motivo: ' || TRIM(p_reason)
      WHERE id = v_rr_id;

      v_voucher_voided := true;
    END IF;

  END IF;

  -- ── 10. Auditoría en audit_billing_logs (OBLIGATORIA) ──────────────────────
  INSERT INTO public.audit_billing_logs (
    action_type,
    table_name,
    record_id,
    old_data,
    new_data,
    changed_by_user_id,
    school_id,
    created_at
  ) VALUES (
    'VOID_PENDING_DEBT_FROM_BILLING',
    'transactions',
    v_tx.id,
    jsonb_build_object(
      'payment_status',  v_tx.payment_status,
      'billing_status',  v_tx.billing_status,
      'amount',          v_tx.amount,
      'student_id',      v_tx.student_id,
      'teacher_id',      v_tx.teacher_id,
      'school_id',       v_tx.school_id,
      'description',     v_tx.description,
      'debt_type',       v_debt_type,
      'lunch_order_id',  v_lunch_order_id
    ),
    jsonb_build_object(
      'payment_status',      'cancelled',
      'cancellation_reason', TRIM(p_reason),
      'void_source',         'void_pending_debt_from_billing',
      'void_role',           v_actor_role,
      'lunch_cancelled',     v_lunch_cancelled,
      'voucher_voided',      v_voucher_voided
    ),
    v_actor_id,
    v_tx.school_id,
    now()
  );

  -- ── 11. Rastro en huella_digital_logs (best-effort) ────────────────────────
  BEGIN
    INSERT INTO public.huella_digital_logs (
      usuario_id,
      accion,
      modulo,
      contexto,
      school_id,
      creado_at
    ) VALUES (
      v_actor_id,
      'ANULACION_DEUDA_PENDIENTE',
      'COBRANZAS',
      jsonb_build_object(
        'transaction_id',  p_transaction_id,
        'debt_type',       v_debt_type,
        'amount',          v_tx.amount,
        'student_id',      v_tx.student_id,
        'teacher_id',      v_tx.teacher_id,
        'lunch_order_id',  v_lunch_order_id,
        'lunch_cancelled', v_lunch_cancelled,
        'voucher_voided',  v_voucher_voided,
        'reason',          TRIM(p_reason),
        'actor_role',      v_actor_role
      ),
      v_tx.school_id,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'void_pending_debt_from_billing: huella_digital_logs falló (no crítico): %', SQLERRM;
  END;

  -- ── 12. Respuesta ──────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',               true,
    'transaction_id',        p_transaction_id,
    'debt_type',             v_debt_type,
    'lunch_order_cancelled', v_lunch_cancelled,
    'voucher_voided',        v_voucher_voided
  );

END;
$fn$;

REVOKE ALL ON FUNCTION public.void_pending_debt_from_billing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_pending_debt_from_billing(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.void_pending_debt_from_billing(uuid, text) IS
  'Anula una deuda pendiente (pending/partial) desde el módulo de Cobranzas.
   Cubre alumnos, profesores y clientes manuales.
   Cancelación atómica: transaction + lunch_order (si aplica) + recharge_request pending (si existe).
   Auditoría dual: audit_billing_logs (obligatoria) + huella_digital_logs (best-effort).
   El trigger trg_transactions_balance_sync recalcula saldo automáticamente.
   Nunca hace DELETE. No toca pasarela ni Izipay. SUNAT: bloqueado si billing_status=sent.';

SELECT 'void_pending_debt_from_billing creado OK' AS resultado;
