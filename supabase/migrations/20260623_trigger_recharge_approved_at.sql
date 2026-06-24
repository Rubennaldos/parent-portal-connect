-- ────────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN: trigger para approved_at en recharge_requests
-- Regla 11.C — El reloj único: los timestamps de aprobación/rechazo deben
-- ser asignados por la base de datos (now()), no por el reloj del cliente.
--
-- Contexto: la columna recharge_requests.approved_at no tiene DEFAULT.
-- Antes de esta migración, el frontend enviaba new Date().toISOString()
-- en el UPDATE, violando Regla 11.C (reloj del browser del admin).
-- Con este trigger, la BD asigna el timestamp con now() automáticamente
-- cuando el status cambia de 'pending' → 'approved' o 'rejected'.
-- El frontend ya no necesita enviar ese campo.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_recharge_request_approved_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo asignar approved_at cuando se produce la transición de estado
  -- pending → approved/rejected. Así no se sobreescribe en otras actualizaciones.
  IF NEW.status IN ('approved', 'rejected')
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND OLD.status = 'pending'
  THEN
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- Eliminar el trigger si ya existe (para poder re-ejecutar la migración de forma idempotente)
DROP TRIGGER IF EXISTS trg_recharge_requests_approved_at ON public.recharge_requests;

CREATE TRIGGER trg_recharge_requests_approved_at
  BEFORE UPDATE ON public.recharge_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_recharge_request_approved_at();

COMMENT ON FUNCTION public.set_recharge_request_approved_at() IS
  'Asigna approved_at = now() cuando recharge_requests.status cambia de pending → approved/rejected. Regla 11.C.';
