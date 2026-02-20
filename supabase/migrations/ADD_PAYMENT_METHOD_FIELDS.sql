-- Agrega campos para activar/desactivar métodos de pago y datos bancarios estructurados
ALTER TABLE billing_config
  ADD COLUMN IF NOT EXISTS yape_enabled          boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS plin_enabled          boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS transferencia_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS bank_name             text,
  ADD COLUMN IF NOT EXISTS bank_account_number   text,
  ADD COLUMN IF NOT EXISTS bank_cci              text;

-- Verificación
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'billing_config'
  AND column_name IN ('yape_enabled','plin_enabled','transferencia_enabled','bank_name','bank_account_number','bank_cci')
ORDER BY column_name;
