-- =====================================================
-- AGREGAR QUANTITY A LUNCH_ORDERS (si no existe)
-- =====================================================

ALTER TABLE lunch_orders 
ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 CHECK (quantity > 0);

COMMENT ON COLUMN lunch_orders.quantity IS 'Cantidad de menús pedidos para este día';
