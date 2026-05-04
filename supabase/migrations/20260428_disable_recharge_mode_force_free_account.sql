-- ============================================================================
-- DESACTIVAR "MODO RECARGA" (temporal) Y FORZAR CUENTA LIBRE
-- Fecha: 2026-04-28
--
-- Objetivo funcional:
--   - El modo recarga no se usa por ahora.
--   - Todos los alumnos operan como cuenta libre.
--   - Se mantienen topes de consumo y kiosco_disabled como controles activos.
-- ============================================================================

BEGIN;

-- 1) Normalizar datos actuales
UPDATE public.students
SET
  free_account = true,
  recharge_enabled = false
WHERE
  COALESCE(free_account, true) IS DISTINCT FROM true
  OR COALESCE(recharge_enabled, false) IS DISTINCT FROM false;

-- 2) Defaults defensivos para nuevos alumnos
ALTER TABLE public.students
  ALTER COLUMN free_account SET DEFAULT true;

ALTER TABLE public.students
  ALTER COLUMN recharge_enabled SET DEFAULT false;

-- 3) Guardrail: evitar que flujos antiguos reactiven "recarga"
CREATE OR REPLACE FUNCTION public.tg_force_free_account_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.free_account := true;
  NEW.recharge_enabled := false;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_force_free_account_mode ON public.students;
CREATE TRIGGER trg_force_free_account_mode
BEFORE INSERT OR UPDATE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.tg_force_free_account_mode();

COMMENT ON FUNCTION public.tg_force_free_account_mode()
IS 'Desactiva temporalmente modo recarga: fuerza free_account=true y recharge_enabled=false.';

COMMIT;
