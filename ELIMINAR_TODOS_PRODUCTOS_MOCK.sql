-- =====================================================
-- ELIMINAR TODOS LOS PRODUCTOS MOCK/PRUEBA
-- =====================================================
-- Este script elimina todos los productos insertados
-- mediante los scripts de prueba anteriores
-- =====================================================

-- OPCIÓN 1: Eliminar productos por imagen URL de dicebear (productos mock)
DELETE FROM products 
WHERE image_url LIKE '%dicebear%';

-- OPCIÓN 2: Eliminar productos por nombres específicos de los scripts
DELETE FROM products 
WHERE name IN (
  'Agua Mineral',
  'Agua Mineral 500ml',
  'Agua San Luis 500ml',
  'Coca Cola 500ml',
  'Inca Kola 500ml',
  'Jugo de Naranja',
  'Jugo de Papaya',
  'Chicha Morada',
  'Papas Lays',
  'Piqueo',
  'Piqueo Surtido',
  'Galletas Oreo',
  'Galletas',
  'Galletas integrales',
  'Chocosoda',
  'Chocolatada',
  'Sublime',
  'Sándwich de Pollo',
  'Hamburguesa',
  'Hamburguesa Clásica',
  'Hot Dog',
  'Pizza Personal',
  'Salchipapa',
  'Empanada de Carne',
  'Barra de Cereal',
  'Menú del Día'
);

-- OPCIÓN 3 (DRÁSTICA): Si quieres borrar ABSOLUTAMENTE TODO
-- y empezar desde cero, descomenta esta línea:
-- DELETE FROM products;

-- =====================================================
-- VERIFICAR QUÉ PRODUCTOS QUEDAN
-- =====================================================
SELECT COUNT(*) as total_productos FROM products;

SELECT id, name, price_sale, category, active, created_at
FROM products 
ORDER BY created_at DESC;

-- =====================================================
-- 📝 NOTA: 
-- Después de ejecutar este script, recarga tu navegador
-- con Ctrl + R o F5 para ver los cambios
-- =====================================================

