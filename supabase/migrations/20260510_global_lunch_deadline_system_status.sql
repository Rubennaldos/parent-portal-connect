-- ============================================================================
-- GLOBAL LUNCH DEADLINE — system_status (id=1)
-- Fecha: 2026-05-10
--
-- Objetivo:
--   Añadir dos campos globales al singleton system_status que centralicen
--   el horario de cierre de pedidos de almuerzo para TODAS las sedes.
--   Antes: cada sede podía tener un valor distinto en lunch_configuration.
--   Ahora: el Admin General fija un único valor que aplica a padres y profesores.
--
-- Reglas:
--   - Operación ADITIVA: no se elimina ninguna columna ni tabla existente.
--   - lunch_configuration sigue siendo la fuente de verdad de cancelaciones,
--     precios y configuración de entrega (usados por RPCs de cancelación).
--   - Solo se centralizan los campos order_deadline_time/days.
--   - El fallback en el frontend es 09:15 / 0 días si el campo es NULL.
-- ============================================================================

ALTER TABLE public.system_status
  ADD COLUMN IF NOT EXISTS global_lunch_deadline_time  time    NOT NULL DEFAULT '09:15:00',
  ADD COLUMN IF NOT EXISTS global_lunch_deadline_days  integer NOT NULL DEFAULT 0;

-- Backfill defensivo para la fila activa (id=1)
UPDATE public.system_status
SET
  global_lunch_deadline_time = COALESCE(global_lunch_deadline_time, '09:15:00'::time),
  global_lunch_deadline_days = COALESCE(global_lunch_deadline_days, 0)
WHERE id = 1;

COMMENT ON COLUMN public.system_status.global_lunch_deadline_time IS
  'Hora límite global para realizar pedidos de almuerzo (aplica a todas las sedes). Formato HH:MM:SS.';

COMMENT ON COLUMN public.system_status.global_lunch_deadline_days IS
  'Días de anticipación globales para el cierre de pedidos (0 = mismo día, 1 = día anterior).';

SELECT '20260510_global_lunch_deadline_system_status ✅ campos globales de deadline de almuerzo agregados' AS resultado;
