-- Agregar columna para habilitar/deshabilitar información de pago
ALTER TABLE public.billing_config 
ADD COLUMN IF NOT EXISTS show_payment_info BOOLEAN DEFAULT false;

-- Actualizar registros existentes para que por defecto esté deshabilitado
UPDATE public.billing_config 
SET show_payment_info = false 
WHERE show_payment_info IS NULL;

SELECT '✅ Columna show_payment_info agregada a billing_config' AS status;
