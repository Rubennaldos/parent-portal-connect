-- =====================================================================
-- Agregar horario programable al modo mantenimiento
-- + soporte para módulos de administración
-- =====================================================================

ALTER TABLE public.maintenance_config
  ADD COLUMN IF NOT EXISTS schedule_start TIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS schedule_end TIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS schedule_timezone TEXT DEFAULT 'America/Lima';

COMMENT ON COLUMN public.maintenance_config.schedule_start IS 'Hora local de inicio del mantenimiento automático (NULL = manual)';
COMMENT ON COLUMN public.maintenance_config.schedule_end IS 'Hora local de fin del mantenimiento automático (NULL = manual)';
COMMENT ON COLUMN public.maintenance_config.schedule_timezone IS 'Zona horaria para el schedule (default Lima)';

SELECT 'maintenance_config: columnas de horario agregadas' AS status;
