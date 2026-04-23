-- ============================================================================
-- PAYMENT METHODS GLOBAL TOGGLE — 2026-04-23
--
-- Objetivo: Añadir control global de métodos de pago en system_status.
--
-- Estrategia:
--   - Sin tablas nuevas. Se añade columna JSONB "payment_methods_config"
--     a la tabla system_status (fila id=1 que ya existe).
--   - Cada flag dentro del JSONB controla si ese método está disponible
--     globalmente para el portal de padres.
--   - "Puente": el mismo array parent_bypass_emails que se usa para
--     saltarse el modo mantenimiento también bypasea estas restricciones.
--     Un correo de prueba ve TODOS los métodos aunque estén desactivados.
--   - Regla de oro: si el campo no existe o hay error al leer → todos los
--     métodos se muestran (nunca bloquear ventas por un error de config).
--
-- Estructura del JSONB:
--   {
--     "yape_active":          true,
--     "plin_active":          true,
--     "transferencia_active": true,
--     "izipay_active":        true
--   }
-- ============================================================================

ALTER TABLE public.system_status
  ADD COLUMN IF NOT EXISTS payment_methods_config jsonb
    NOT NULL
    DEFAULT '{"yape_active":true,"plin_active":true,"transferencia_active":true,"izipay_active":true}'::jsonb;

-- Inicializar el registro existente con valores por defecto (todos activos)
UPDATE public.system_status
SET    payment_methods_config = COALESCE(
         payment_methods_config,
         '{"yape_active":true,"plin_active":true,"transferencia_active":true,"izipay_active":true}'::jsonb
       )
WHERE  id = 1;

-- Comentario descriptivo
COMMENT ON COLUMN public.system_status.payment_methods_config IS
  'Control global de métodos de pago visibles en el Portal de Padres. '
  'Estructura: {yape_active, plin_active, transferencia_active, izipay_active}. '
  'Los correos en parent_bypass_emails bypasean estas restricciones (puente de pruebas). '
  'Si NULL o falla la lectura → todos los métodos activos (regla defensiva).';

SELECT 'payment_methods_config añadido a system_status — todos los métodos activos por defecto' AS resultado;
