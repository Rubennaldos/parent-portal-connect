-- ============================================================================
-- SIMPLIFICACIÓN: Topes de Consumo → solo SEMANAL
--
-- Orden de administración: un único período (semana calendario, Lunes 00:00 Lima).
--
-- Cambios:
--  1. RPC get_student_spending_summary → devuelve spent_week + next_reset_at
--  2. tg_enforce_spending_limit        → solo valida weekly_limit
--
-- INVARIANTES PRESERVADOS (Regla #11 Triple Restricción):
--  11.A  Cálculo de gasto → SQL, no JS
--  11.B  Bloqueo de operación ilegal → Trigger BEFORE INSERT
--  11.C  Reloj único → now() AT TIME ZONE 'America/Lima'
--
-- DATOS NO TOCADOS:
--  students.daily_limit, students.monthly_limit → permanecen en la BD,
--  solo dejan de aplicarse en el trigger y el RPC.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) RPC get_student_spending_summary — versión semanal
--    Devuelve:
--      spent_week   → gasto kiosco acumulado desde el lunes 00:00 Lima
--      next_reset_at → próximo lunes 00:00 Lima (en ISO con zona Lima)
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
  v_week_start  timestamptz;
  v_next_reset  timestamptz;
  v_spent_week  numeric := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN jsonb_build_object('spent_week', 0, 'next_reset_at', NULL);
  END IF;

  -- Reloj único: servidor en Lima (Regla #11.C)
  v_now_lima   := timezone('America/Lima', now());
  -- Lunes 00:00 de la semana actual (PostgreSQL: semana empieza el lunes)
  v_week_start := date_trunc('week', v_now_lima) AT TIME ZONE 'America/Lima';
  -- Próximo lunes 00:00 Lima = inicio semana + 7 días
  v_next_reset := (date_trunc('week', v_now_lima) + interval '7 days') AT TIME ZONE 'America/Lima';

  -- Gasto semanal: solo kiosco (sin almuerzos), no cancelado, no borrado
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_week
  FROM public.transactions t
  WHERE t.student_id             = p_student_id
    AND t.type                   = 'purchase'
    AND t.is_deleted             = false
    AND t.payment_status        != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at            >= v_week_start;

  RETURN jsonb_build_object(
    'spent_week',    v_spent_week,
    'next_reset_at', v_next_reset
  );
END;
$function$;

COMMENT ON FUNCTION public.get_student_spending_summary(uuid)
IS 'SSOT semanal: devuelve gasto de kiosco acumulado desde el lunes 00:00 Lima y la fecha del próximo reinicio. Reloj único: now() AT TIME ZONE America/Lima.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Función del trigger de bloqueo — versión solo semanal
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_enforce_spending_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student    RECORD;
  v_now_lima   timestamptz;
  v_week_start timestamptz;
  v_spent_week numeric := 0;
  v_available  numeric := 0;
BEGIN
  -- Solo compras de kiosco: type='purchase' sin lunch_order_id
  IF NEW.type IS DISTINCT FROM 'purchase' THEN
    RETURN NEW;
  END IF;

  IF (NEW.metadata->>'lunch_order_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cargar configuración del alumno (lock compartido contra race condition)
  SELECT kiosk_disabled, limit_type, weekly_limit
    INTO v_student
  FROM public.students
  WHERE id = NEW.student_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- ── Guard 1: kiosco desactivado ──────────────────────────────────────────
  IF v_student.kiosk_disabled IS TRUE THEN
    RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado. Solo puede pedir almuerzos desde el calendario.';
  END IF;

  -- ── Guard 2: tope semanal ────────────────────────────────────────────────
  -- Solo se aplica si limit_type = 'weekly' y weekly_limit > 0
  IF v_student.limit_type IS DISTINCT FROM 'weekly' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_student.weekly_limit, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Reloj único: Lima (Regla #11.C)
  v_now_lima   := timezone('America/Lima', now());
  v_week_start := date_trunc('week', v_now_lima) AT TIME ZONE 'America/Lima';

  -- Gasto de la semana actual (kiosco, sin almuerzos)
  SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO v_spent_week
  FROM public.transactions t
  WHERE t.student_id             = NEW.student_id
    AND t.type                   = 'purchase'
    AND t.is_deleted             = false
    AND t.payment_status        != 'cancelled'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.created_at            >= v_week_start;

  v_available := GREATEST(0, v_student.weekly_limit - v_spent_week);

  IF (v_spent_week + ABS(NEW.amount)) > v_student.weekly_limit THEN
    RAISE EXCEPTION 'SPENDING_LIMIT: Tope semanal superado. Gastado esta semana: S/ %, disponible: S/ %, compra intentada: S/ %.',
      round(v_spent_week, 2),
      round(v_available, 2),
      round(ABS(NEW.amount), 2);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_enforce_spending_limit()
IS 'Muralla final (Regla #11.B): bloquea kiosk_disabled y weekly_limit. Solo compras de kiosco (type=purchase sin lunch_order_id). Reloj único: Lima. Lanza KIOSK_DISABLED o SPENDING_LIMIT.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Verificación: trigger sigue activo
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'transactions'
  AND trigger_name = 'trg_enforce_spending_limit';

COMMIT;
