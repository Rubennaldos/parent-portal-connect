-- ═══════════════════════════════════════════════════════════════════════════
-- Desactivar mantenimiento de topes en maintenance_config
-- Fecha: 2026-04-06
--
-- Si había una entrada activa en maintenance_config que bloqueaba la
-- configuración de topes/tipo de cuenta para los padres, este script
-- la desactiva. Las recargas siguen bloqueadas por código (RECHARGES_MAINTENANCE=true).
-- ═══════════════════════════════════════════════════════════════════════════

-- Desactivar cualquier módulo relacionado con topes/config que esté activo
UPDATE public.maintenance_config
SET enabled = false
WHERE module_key IN (
  'topes_padres',
  'config_topes',
  'config_padres',
  'spending_limits',
  'tipo_cuenta',
  'configuracion_padres'
)
AND enabled = true;

-- Verificar estado actual de todos los módulos activos
SELECT
  module_key,
  enabled,
  title,
  LEFT(message, 60) AS message_preview
FROM public.maintenance_config
WHERE enabled = true
ORDER BY module_key;

SELECT '✅ Mantenimiento de topes desactivado — configuración de topes accesible para padres' AS status;
