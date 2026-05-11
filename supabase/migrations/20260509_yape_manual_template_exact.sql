-- ============================================================================
-- HOTFIX: plantilla exacta para Yape Manual en system_status (id=1)
-- Fecha: 2026-05-09
-- ============================================================================

ALTER TABLE public.system_status
  ALTER COLUMN yape_manual_template
  SET DEFAULT 'Hola, soy {parent_name} y estoy pagando un total de S/ {total_amount} por el comprobante #{ticket_code} de la fecha {date}. Adjunto el comprobante, por favor confirmen mi abono. Muchas gracias.';

-- Forzar el texto exacto en la fila global actual para evitar arrastrar plantillas antiguas
UPDATE public.system_status
SET yape_manual_template = 'Hola, soy {parent_name} y estoy pagando un total de S/ {total_amount} por el comprobante #{ticket_code} de la fecha {date}. Adjunto el comprobante, por favor confirmen mi abono. Muchas gracias.'
WHERE id = 1;

SELECT '20260509_yape_manual_template_exact ✅ plantilla exacta aplicada en system_status.id=1' AS resultado;
