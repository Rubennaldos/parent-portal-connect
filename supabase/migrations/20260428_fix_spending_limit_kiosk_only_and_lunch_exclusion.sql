-- ============================================================================
-- FIX CONSISTENTE: Topes solo para kiosco, nunca para almuerzos
-- Fecha: 2026-04-28
--
-- Problema:
--   tg_enforce_spending_limit estaba bloqueando compras de almuerzo
--   con WEEKLY_LIMIT_EXCEEDED, rompiendo la regla de oro.
--
-- Regla de negocio:
--   - Topes (daily/weekly/monthly) aplican SOLO a kiosco/POS.
--   - Almuerzos (metadata.lunch_order_id != NULL) NUNCA deben bloquearse por tope.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_enforce_spending_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student       RECORD;
  v_now_lima      timestamptz;
  v_period_start  timestamptz;
  v_limit_amount  numeric := 0;
  v_spent_period  numeric := 0;
  v_available     numeric := 0;
BEGIN
  -- Bypass controlado para flujos administrativos
  IF current_setting('app.bypass_spending_limit', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Solo compras
  IF NEW.type IS DISTINCT FROM 'purchase' THEN
    RETURN NEW;
  END IF;

  -- Regla de oro: almuerzo no se mezcla con tope de kiosco
  IF (NEW.metadata->>'lunch_order_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Solo alumnos
  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Solo estados que cuentan para consumo
  IF COALESCE(NEW.payment_status, 'pending') NOT IN ('pending', 'paid') THEN
    RETURN NEW;
  END IF;

  SELECT
    kiosk_disabled,
    COALESCE(limit_type, 'none') AS limit_type,
    COALESCE(daily_limit, 0)     AS daily_limit,
    COALESCE(weekly_limit, 0)    AS weekly_limit,
    COALESCE(monthly_limit, 0)   AS monthly_limit
  INTO v_student
  FROM public.students
  WHERE id = NEW.student_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_student.kiosk_disabled, false) THEN
    RAISE EXCEPTION 'KIOSK_DISABLED: Este alumno tiene el kiosco desactivado. Solo puede pedir almuerzos.';
  END IF;

  IF v_student.limit_type = 'none' THEN
    RETURN NEW;
  END IF;

  v_now_lima := timezone('America/Lima', now());

  IF v_student.limit_type = 'daily' THEN
    v_limit_amount := v_student.daily_limit;
    v_period_start := date_trunc('day', v_now_lima) AT TIME ZONE 'America/Lima';
  ELSIF v_student.limit_type = 'weekly' THEN
    v_limit_amount := v_student.weekly_limit;
    v_period_start := date_trunc('week', v_now_lima) AT TIME ZONE 'America/Lima';
  ELSIF v_student.limit_type = 'monthly' THEN
    v_limit_amount := v_student.monthly_limit;
    v_period_start := date_trunc('month', v_now_lima) AT TIME ZONE 'America/Lima';
  ELSE
    RETURN NEW;
  END IF;

  IF v_limit_amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(ABS(t.amount)), 0)
  INTO   v_spent_period
  FROM   public.transactions t
  WHERE  t.student_id = NEW.student_id
    AND  t.type = 'purchase'
    AND  t.is_deleted IS DISTINCT FROM true
    AND  t.payment_status != 'cancelled'
    AND  (t.metadata->>'lunch_order_id') IS NULL
    AND  t.created_at >= v_period_start;

  v_available := GREATEST(0, v_limit_amount - v_spent_period);

  IF (v_spent_period + ABS(NEW.amount)) > v_limit_amount THEN
    RAISE EXCEPTION
      'SPENDING_LIMIT: Tope % superado. Gastado: S/ %, disponible: S/ %, compra: S/ %.',
      v_student.limit_type,
      round(v_spent_period, 2),
      round(v_available, 2),
      round(ABS(NEW.amount), 2);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_spending_limit ON public.transactions;
CREATE TRIGGER trg_enforce_spending_limit
BEFORE INSERT ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_spending_limit();

COMMENT ON FUNCTION public.tg_enforce_spending_limit()
IS 'v4 2026-04-28: topes solo kiosco (purchase sin lunch_order_id). Almuerzos siempre fuera de topes.';
