-- Agrega columnas de bypass de email a system_status
-- Permite que usuarios de prueba entren aunque el portal esté en mantenimiento.

ALTER TABLE system_status
  ADD COLUMN IF NOT EXISTS parent_bypass_emails text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS admin_bypass_emails  text[] DEFAULT '{}';

-- Aseguramos que la fila inicial tenga los defaults
UPDATE system_status
SET
  parent_bypass_emails = COALESCE(parent_bypass_emails, '{}'),
  admin_bypass_emails  = COALESCE(admin_bypass_emails,  '{}')
WHERE id = 1;
