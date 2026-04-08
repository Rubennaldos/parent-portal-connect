-- ============================================================
-- Kill Switch: Motor IA de Auditoría de Vouchers
-- ============================================================
-- Agrega la columna disable_voucher_ai a billing_config.
-- DEFAULT TRUE → la IA queda APAGADA inmediatamente al aplicar
-- esta migración, sin necesidad de un paso manual extra.
--
-- Cuando disable_voucher_ai = TRUE:
--   - No se llama a la Edge Function analizar-voucher
--   - No se consume quota de OpenAI
--   - El monto y N° de operación del padre son la fuente de verdad
--   - El voucher queda listo para revisión manual del admin
--
-- Para reactivar la IA: UPDATE billing_config SET disable_voucher_ai = FALSE;
-- ============================================================

ALTER TABLE billing_config
  ADD COLUMN IF NOT EXISTS disable_voucher_ai BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN billing_config.disable_voucher_ai IS
  'Kill switch del motor IA de auditoría (GPT-4o Vision). '
  'TRUE = IA desactivada, el monto del padre es fuente de verdad. '
  'FALSE = IA activa, analiza cada voucher antes de aprobar.';

-- Asegurar que todos los registros existentes tengan la IA desactivada
UPDATE billing_config
SET disable_voucher_ai = TRUE
WHERE disable_voucher_ai IS NULL OR disable_voucher_ai = FALSE;

-- Vista informativa para el admin (opcional, útil en el dashboard)
DO $$
BEGIN
  -- Solo mostrar estado actual por sede
  RAISE NOTICE '=== Estado del Kill Switch IA ===';
  RAISE NOTICE 'disable_voucher_ai = TRUE en todos los registros de billing_config.';
  RAISE NOTICE 'La IA está APAGADA. Para reactivar: UPDATE billing_config SET disable_voucher_ai = FALSE WHERE school_id = ''<uuid>'';';
END $$;
