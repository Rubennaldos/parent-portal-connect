-- ============================================================================
-- Control de Pasarelas de Pago por Sede
-- Fecha: 2026-04-21
--
-- Agrega columna izipay_enabled a billing_config.
-- Las columnas yape_enabled, plin_enabled y transferencia_enabled ya existen.
--
-- Por defecto izipay_enabled = false (opt-in por sede).
-- Activación global: UPDATE billing_config SET izipay_enabled = true;
-- ============================================================================

ALTER TABLE public.billing_config
  ADD COLUMN IF NOT EXISTS izipay_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.billing_config.izipay_enabled IS
  'Controla si el botón IziPay (tarjeta/Yape QR) es visible para los padres de esta sede. '
  'false = botón gris/deshabilitado en el portal. '
  'true  = botón activo. El admin lo gestiona desde Facturación Electrónica → Config SUNAT.';

-- Activación inmediata para TODAS las sedes
UPDATE public.billing_config
SET    izipay_enabled = true
WHERE  izipay_enabled = false;

-- Verificación rápida
SELECT school_id, izipay_enabled, yape_enabled, plin_enabled, transferencia_enabled
FROM   public.billing_config
ORDER  BY school_id;
