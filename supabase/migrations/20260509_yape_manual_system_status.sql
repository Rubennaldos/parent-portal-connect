-- ============================================================================
-- YAPE MANUAL GLOBAL CONFIG (system_status id=1)
-- Fecha: 2026-05-09
--
-- Objetivo:
--   Extender la configuración global existente en system_status para habilitar
--   y parametrizar el flujo visual de Yape Manual en el portal de padres.
--
-- Reglas:
--   - NO se tocan pasarelas oficiales ni lógica de IziPay.
--   - Se reutiliza el patrón singleton id=1 ya vigente.
--   - Se mantienen políticas RLS existentes (SELECT authenticated / UPDATE superadmin).
-- ============================================================================

ALTER TABLE public.system_status
  ADD COLUMN IF NOT EXISTS yape_manual_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS yape_manual_phone text,
  ADD COLUMN IF NOT EXISTS yape_manual_template text;

-- Backfill defensivo para instalaciones previas
UPDATE public.system_status
SET
  yape_manual_active   = COALESCE(yape_manual_active, false),
  yape_manual_phone    = COALESCE(yape_manual_phone, ''),
  yape_manual_template = COALESCE(
    yape_manual_template,
    'Hola, ya realicé mi pago manual de S/ {monto} para {estudiante}. Código de aprobación: '
  )
WHERE id = 1;

COMMENT ON COLUMN public.system_status.yape_manual_active IS
  'Activa/desactiva la opción Yape Manual en el portal de padres.';

COMMENT ON COLUMN public.system_status.yape_manual_phone IS
  'Número de WhatsApp de destino para pagos manuales (solo dígitos, con o sin prefijo país).';

COMMENT ON COLUMN public.system_status.yape_manual_template IS
  'Plantilla de mensaje WhatsApp para pago manual. Soporta placeholders {monto} y {estudiante}.';

SELECT '20260509_yape_manual_system_status ✅ columnas globales de Yape Manual agregadas' AS resultado;
