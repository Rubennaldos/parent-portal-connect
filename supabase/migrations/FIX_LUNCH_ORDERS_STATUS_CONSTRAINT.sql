-- =====================================================
-- Fix constraint en lunch_orders para permitir 'pending'
-- =====================================================

-- Ver el constraint actual
-- SELECT conname, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'lunch_orders'::regclass 
-- AND conname LIKE '%status%';

-- Eliminar el constraint antiguo si existe
ALTER TABLE lunch_orders DROP CONSTRAINT IF EXISTS lunch_orders_status_check;

-- Crear el nuevo constraint con los valores correctos
ALTER TABLE lunch_orders 
ADD CONSTRAINT lunch_orders_status_check 
CHECK (status IN ('pending', 'confirmed', 'delivered', 'cancelled'));

-- Comentario
COMMENT ON CONSTRAINT lunch_orders_status_check ON lunch_orders IS 
'Valores permitidos: pending, confirmed, delivered, cancelled';
