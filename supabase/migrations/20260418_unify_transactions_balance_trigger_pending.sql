-- ============================================================================
-- MIGRACION CANONICA: Unificacion de sincronizacion de balance por transactions
-- Regla de negocio preservada: students.balance = deuda pendiente total
-- => SUM(transactions.amount) WHERE payment_status = 'pending' AND is_deleted=false
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Limpieza atomica de triggers redundantes en transactions
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_refresh_student_balance_from_transactions ON public.transactions;
DROP TRIGGER IF EXISTS trg_refresh_student_balance_on_transactions ON public.transactions;

-- Limpieza defensiva de variantes historicas del mismo mecanismo
DROP TRIGGER IF EXISTS trg_refresh_student_balance ON public.transactions;
DROP TRIGGER IF EXISTS trg_refresh_student_balance_upd ON public.transactions;
DROP TRIGGER IF EXISTS trg_transactions_balance_sync ON public.transactions;

-- ---------------------------------------------------------------------------
-- 2) Limpieza atomica de funciones asociadas redundantes
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tg_refresh_student_balance_from_transactions();
DROP FUNCTION IF EXISTS public.tg_refresh_student_balance();
DROP FUNCTION IF EXISTS public.fn_refresh_student_balance(uuid);
DROP FUNCTION IF EXISTS public.fn_refresh_student_balance_from_view(uuid);

-- Limpieza defensiva de wrappers historicos
DROP FUNCTION IF EXISTS public.trg_refresh_student_balance_fn();
DROP FUNCTION IF EXISTS public.tg_transactions_balance_sync();

-- ---------------------------------------------------------------------------
-- 3) Funcion unificada (industrial) con lock de concurrencia por alumno
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_student_balance(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_total numeric := 0;
  v_lock_key bigint;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN;
  END IF;

  -- Lock transaccional por alumno para serializar recalculos concurrentes.
  -- UUID -> bigint estable via hash de texto (equivalente practico al requisito).
  v_lock_key := ('x' || substr(md5(p_student_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COALESCE(SUM(t.amount), 0)
    INTO v_pending_total
  FROM public.transactions t
  WHERE t.student_id = p_student_id
    AND t.is_deleted = false
    AND t.payment_status = 'pending';

  UPDATE public.students s
  SET balance = v_pending_total
  WHERE s.id = p_student_id;
END;
$function$;

COMMENT ON FUNCTION public.fn_sync_student_balance(uuid)
IS 'Sincroniza students.balance como deuda pendiente total desde transactions pending no borradas, con advisory lock por student_id.';

-- ---------------------------------------------------------------------------
-- 4) Funcion trigger unica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_transactions_balance_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_sync_student_balance(NEW.student_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      PERFORM public.fn_sync_student_balance(OLD.student_id);
      PERFORM public.fn_sync_student_balance(NEW.student_id);
    ELSE
      PERFORM public.fn_sync_student_balance(NEW.student_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.fn_sync_student_balance(OLD.student_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.tg_transactions_balance_sync()
IS 'Trigger handler unico para mantener students.balance sincronizado con transacciones pending.';

-- ---------------------------------------------------------------------------
-- 5) Trigger unico
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_transactions_balance_sync
AFTER INSERT OR UPDATE OR DELETE
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.tg_transactions_balance_sync();

-- ---------------------------------------------------------------------------
-- 6) Verificacion: alumno "dddddd"
-- ---------------------------------------------------------------------------
-- Balance almacenado vs suma real pending/no borrada
SELECT
  s.id,
  s.full_name,
  s.balance AS balance_en_students,
  COALESCE((
    SELECT SUM(t.amount)
    FROM public.transactions t
    WHERE t.student_id = s.id
      AND t.is_deleted = false
      AND t.payment_status = 'pending'
  ), 0) AS balance_calculado_pending
FROM public.students s
WHERE s.full_name ILIKE '%dddddd%';

COMMIT;
