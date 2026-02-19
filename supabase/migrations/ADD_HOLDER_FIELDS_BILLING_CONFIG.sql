-- Agregar campos de titular por método de pago en billing_config
ALTER TABLE billing_config
  ADD COLUMN IF NOT EXISTS bank_account_holder text,
  ADD COLUMN IF NOT EXISTS yape_holder         text,
  ADD COLUMN IF NOT EXISTS plin_holder          text;

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'billing_config'
  AND column_name IN ('bank_account_holder','yape_holder','plin_holder');
