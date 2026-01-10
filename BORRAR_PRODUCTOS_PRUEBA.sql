-- =====================================================
-- ELIMINAR PRODUCTOS DE PRUEBA
-- =====================================================

-- Eliminar productos que tengan nombres comunes de prueba
DELETE FROM products 
WHERE 
  name ILIKE '%prueba%' 
  OR name ILIKE '%test%' 
  OR name ILIKE '%demo%'
  OR name ILIKE '%ejemplo%'
  OR name ILIKE '%mock%';

-- Si quieres borrar TODOS los productos para empezar de cero, usa esta línea (descoméntala):
-- DELETE FROM products;

-- Verificar los productos que quedan
SELECT id, name, price_sale, active, created_at
FROM products 
ORDER BY created_at DESC;

