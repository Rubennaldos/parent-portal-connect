-- Agregar plantillas separadas por tipo de deudor
ALTER TABLE billing_config
  ADD COLUMN IF NOT EXISTS student_message_template TEXT,
  ADD COLUMN IF NOT EXISTS teacher_message_template TEXT;

COMMENT ON COLUMN billing_config.student_message_template IS 'Plantilla WhatsApp para alumnos (va dirigida al padre)';
COMMENT ON COLUMN billing_config.teacher_message_template IS 'Plantilla WhatsApp para profesores y clientes manuales';
