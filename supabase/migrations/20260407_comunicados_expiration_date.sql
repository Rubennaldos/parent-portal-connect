-- ============================================================
-- Añadir columna expiration_date a in_app_notifications
-- Permite fijar fecha de vencimiento opcional por comunicado.
-- NULL = nunca vence (visible indefinidamente).
-- ============================================================

ALTER TABLE public.in_app_notifications
  ADD COLUMN IF NOT EXISTS expiration_date TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.in_app_notifications.expiration_date IS
  'Fecha límite de visibilidad. NULL = sin vencimiento. Los portales de padres filtran solo mensajes donde expiration_date > now() OR expiration_date IS NULL.';

-- Índice para que el filtro de fecha sea rápido
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_expiration
  ON public.in_app_notifications (expiration_date)
  WHERE expiration_date IS NOT NULL;

SELECT 'expiration_date añadida a in_app_notifications ✅' AS resultado;
