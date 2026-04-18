-- ============================================================================
-- MÓDULO: Topes de Consumo — Arquitectura Bancaria
--
-- 1. RPC get_student_spending_summary  → gasto real por período (SSOT para el frontend)
-- 2. Trigger BEFORE INSERT en transactions → muralla final en la BD
--
-- REGLAS PRESERVADAS:
--  - Regla #1: Almuerzos y kiosco son INDEPENDIENTES.
--    El trigger NO bloquea transacciones con metadata->>'lunch_order_id' ≠ NULL.
--  - Regla #9: fn_sync_student_balance es el único cerebro contable de balance.
--    Este trigger NO toca students.balance, solo bloquea o permite el INSERT.
--  - Solo compras de kiosco (type = 'purchase' sin lunch_order_id) están sujetas
--    al tope. Recargas, pagos de almuerzo, etc. pasan sin restricción.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) RPC: get_student_spending_summary
--    Devuelve el gasto real acumulado por período (kiosco, sin almuerzos).
--    Usado por SpendingLimitsModal para la barra de progreso.
--    Zona horaria: America/Lima (UTC-5, sin horario de verano).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_student_spending_summary(
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now_lima    timestamptz;
  v_today_start timestamptz;
  v_week_start  timestamptz;
  v_month_start timestamptz;
  v_spent_day   numeric := 0;
  v_spent_week  numeric := 0;
  v_spent_month numeric := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN jsonb_build_object('spent_today', 0, 'spent_week', 0, 'spent_month', 0);
  END IF;

  -- Hora Lima actual y límites de período
  v_now_lima    := timezone('America/Lima', now());
  v_today_start := date_trunc('day',   v_now_lima) AT TIME ZONE 'America/Lima';
  v_week_start  := date_trunc('week',  v_now_lima) AT TIME ZONE 'America/Lima';
  v_month_start := date_trunc('month', v_now_lima) AT TIME ZONE 'America/Lima';

  -- Gasto diario (solo kiosco, no almuerzos, no cancelados, no borrados)
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_day
  FROM public.transactions t
  WHERE t.student_id             = p_student_id
    AND t.type                   = 'purchase'
    AND t.is_deleted             = false
    AND t.payment_status        != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at            >= v_today_start;

  -- Gasto semanal
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_week
  FROM public.transactions t
  WHERE t.student_id             = p_student_id
    AND t.type                   = 'purchase'
    AND t.is_deleted             = false
    AND t.payment_status        != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at            >= v_week_start;

  -- Gasto mensual
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_month
  FROM public.transactions t
  WHERE t.student_id             = p_student_id
    AND t.type                   = 'purchase'
    AND t.is_deleted             = false
    AND t.payment_status        != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at            >= v_month_start;

  RETURN jsonb_build_object(
    'spent_today',  v_spent_day,
    'spent_week',   v_spent_week,
    'spent_month',  v_spent_month
  );
END;
$function$;

COMMENT ON FUNCTION public.get_student_spending_summary(uuid)
IS 'Devuelve gasto real del alumno en kiosco (sin almuerzos) por período diario/semanal/mensual en zona America/Lima. SSOT para la barra de progreso del portal de padres.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Función del trigger de bloqueo (BEFORE INSERT)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_enforce_spending_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student       RECORD;
  v_period_start  timestamptz;
  v_now_lima      timestamptz;
  v_limit_amount  numeric := 0;
  v_spent_period  numeric := 0;
  v_available     numeric := 0;
BEGIN
  -- Solo compras de kiosco: type='purchase' sin lunch_order_id
  IF NEW.type IS DISTINCT FROM 'purchase' THEN
    RETURN NEW;
  END IF;

  -- Las transacciones de pago de almuerzo llevan lunch_order_id en metadata
  IF (NEW.metadata->>'lunch_order_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Solo si pertenece a un alumno
  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Leer configuración del alumno (con lock para evitar race conditions)
  SELECT kiosk_disabled, limit_type, daily_limit, weekly_limit, monthly_limit
    INTO v_student
  FROM public.students
  WHERE id = NEW.student_id
  FOR SHARE;  -- lock compartido: bloquea escrituras concurrentes de límite

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- ── Guard 1: kiosco desactivado ──────────────────────────────────────────
  IF v_student.kiosk_disabled IS TRUE THEN
    RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado. Solo puede pedir almuerzos desde el calendario.';
  END IF;

  -- ── Guard 2: tope de consumo ─────────────────────────────────────────────
  IF v_student.limit_type IS NULL OR v_student.limit_type = 'none' THEN
    RETURN NEW;
  END IF;

  v_now_lima := timezone('America/Lima', now());

  IF v_student.limit_type = 'daily' THEN
    v_limit_amount := COALESCE(v_student.daily_limit, 0);
    v_period_start := date_trunc('day', v_now_lima) AT TIME ZONE 'America/Lima';

  ELSIF v_student.limit_type = 'weekly' THEN
    v_limit_amount := COALESCE(v_student.weekly_limit, 0);
    v_period_start := date_trunc('week', v_now_lima) AT TIME ZONE 'America/Lima';

  ELSIF v_student.limit_type = 'monthly' THEN
    v_limit_amount := COALESCE(v_student.monthly_limit, 0);
    v_period_start := date_trunc('month', v_now_lima) AT TIME ZONE 'America/Lima';

  ELSE
    RETURN NEW;
  END IF;

  IF v_limit_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Suma del período actual (kiosco, sin almuerzos, no cancelado, no borrado)
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_period
  FROM public.transactions t
  WHERE t.student_id             = NEW.student_id
    AND t.type                   = 'purchase'
    AND t.is_deleted             = false
    AND t.payment_status        != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at            >= v_period_start;

  v_available := GREATEST(0, v_limit_amount - v_spent_period);

  IF (v_spent_period + ABS(NEW.amount)) > v_limit_amount THEN
    RAISE EXCEPTION 'SPENDING_LIMIT: Tope % superado. Gastado: S/ %, disponible: S/ %, compra intentada: S/ %.',
      v_student.limit_type,
      round(v_spent_period, 2),
      round(v_available, 2),
      round(ABS(NEW.amount), 2);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_enforce_spending_limit()
IS 'Muralla final: bloquea INSERTs en transactions que violen kiosk_disabled o los topes diario/semanal/mensual. Solo aplica a compras de kiosco (type=purchase sin lunch_order_id).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Trigger BEFORE INSERT en transactions
-- ────────────────────────────────────────────────────────────────────────────

-- Limpieza defensiva (idempotente)
DROP TRIGGER IF EXISTS trg_enforce_spending_limit ON public.transactions;

CREATE TRIGGER trg_enforce_spending_limit
BEFORE INSERT
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_spending_limit();

COMMENT ON TRIGGER trg_enforce_spending_limit ON public.transactions
IS 'BEFORE INSERT: verifica kiosk_disabled y topes de consumo antes de permitir el INSERT. Bloquea con RAISE EXCEPTION usando prefijos legibles por el POS (KIOSK_DISABLED, SPENDING_LIMIT).';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Verificación de integridad
-- ────────────────────────────────────────────────────────────────────────────
-- Confirmar que el trigger existe y está activo
SELECT
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'transactions'
  AND trigger_name = 'trg_enforce_spending_limit';

COMMIT;
