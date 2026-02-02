-- ============================================
-- AGREGAR CONFIGURACIÓN DE CIERRE DE DÍA
-- ============================================

-- Agregar campos para cierre automático del día
ALTER TABLE public.lunch_configuration
ADD COLUMN IF NOT EXISTS delivery_start_time TIME DEFAULT '07:00:00',
ADD COLUMN IF NOT EXISTS delivery_end_time TIME DEFAULT '17:00:00',
ADD COLUMN IF NOT EXISTS auto_close_day BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_mark_as_delivered BOOLEAN DEFAULT true;

-- Comentarios para documentar
COMMENT ON COLUMN public.lunch_configuration.delivery_start_time IS 'Hora de inicio de entregas de almuerzos';
COMMENT ON COLUMN public.lunch_configuration.delivery_end_time IS 'Hora de cierre del día (después de esta hora, el sistema pasa al día siguiente)';
COMMENT ON COLUMN public.lunch_configuration.auto_close_day IS 'Si es true, el sistema cierra el día automáticamente a la hora configurada';
COMMENT ON COLUMN public.lunch_configuration.auto_mark_as_delivered IS 'Si es true, los pedidos "confirmed" se marcan como "delivered" al cerrar el día';

-- Verificar campos agregados
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'lunch_configuration'
AND column_name IN ('delivery_start_time', 'delivery_end_time', 'auto_close_day', 'auto_mark_as_delivered')
ORDER BY ordinal_position;
