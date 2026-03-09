-- Agregar plantillas separadas para almuerzos y cafetería
ALTER TABLE billing_config
  ADD COLUMN IF NOT EXISTS lunch_message_template TEXT,
  ADD COLUMN IF NOT EXISTS cafeteria_message_template TEXT;

COMMENT ON COLUMN billing_config.lunch_message_template IS 'Plantilla WhatsApp para cobranza de almuerzos';
COMMENT ON COLUMN billing_config.cafeteria_message_template IS 'Plantilla WhatsApp para cobranza de cafetería';
