-- Actualizar categorías existentes para permitir agregados por defecto
-- Solo para categorías que NO son de venta de cocina
UPDATE lunch_categories
SET allows_addons = true
WHERE is_kitchen_sale IS NULL OR is_kitchen_sale = false;

-- Las categorías de venta de cocina NO permiten agregados
UPDATE lunch_categories
SET allows_addons = false
WHERE is_kitchen_sale = true;
