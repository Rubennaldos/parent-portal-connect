-- =====================================================
-- SCRIPT: TRACKING VENTAS POR PRODUCTO
-- Fecha: 2026-01-07
-- Descripción: Agregar contador de ventas a productos
-- =====================================================

-- Agregar columna de ventas totales
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS total_sales INTEGER DEFAULT 0;

-- Crear función para actualizar contador de ventas
CREATE OR REPLACE FUNCTION update_product_sales_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Actualizar el contador de ventas del producto
  UPDATE products
  SET total_sales = total_sales + NEW.quantity
  WHERE id = NEW.product_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear trigger para actualizar automáticamente
DROP TRIGGER IF EXISTS trigger_update_product_sales ON transaction_items;
CREATE TRIGGER trigger_update_product_sales
  AFTER INSERT ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION update_product_sales_count();

-- Crear índice para optimizar consultas de productos más vendidos
CREATE INDEX IF NOT EXISTS idx_products_total_sales 
ON products(total_sales DESC);

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================

