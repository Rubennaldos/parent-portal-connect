-- ========================================================
-- INSERTAR PRODUCTOS - ESTRUCTURA CORRECTA
-- ========================================================
-- Columnas: id, name, price, category, image_url, active, created_at

-- 1. Limpiar productos anteriores (opcional)
DELETE FROM products;

-- 2. Insertar productos con la estructura correcta
-- BEBIDAS
INSERT INTO products (name, price, category, image_url, active) VALUES
('Agua Mineral 500ml', 2.00, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=water', TRUE),
('Coca Cola 500ml', 3.50, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=cocacola', TRUE),
('Inca Kola 500ml', 3.50, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=incakola', TRUE),
('Jugo de Naranja', 4.50, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=orange', TRUE),
('Chicha Morada', 3.00, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=chicha', TRUE);

-- SNACKS
INSERT INTO products (name, price, category, image_url, active) VALUES
('Papas Lays', 2.50, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=lays', TRUE),
('Piqueo Surtido', 3.00, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=piqueo', TRUE),
('Galletas Oreo', 2.00, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=oreo', TRUE),
('Chocosoda', 1.50, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=chocosoda', TRUE),
('Sublime', 2.50, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=sublime', TRUE);

-- MENÚ
INSERT INTO products (name, price, category, image_url, active) VALUES
('Sándwich de Pollo', 8.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=sandwich', TRUE),
('Hamburguesa Clásica', 10.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=burger', TRUE),
('Hot Dog', 7.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=hotdog', TRUE),
('Pizza Personal', 9.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=pizza', TRUE),
('Salchipapa', 6.50, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=salchipapa', TRUE),
('Empanada de Carne', 4.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=empanada', TRUE);

-- 3. Verificar
SELECT id, name, price, category, active 
FROM products 
ORDER BY category, price;

-- 4. Verificar RLS (si ya existe, no da error)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Política para que cajeros puedan leer productos
DROP POLICY IF EXISTS "Allow read for authenticated" ON products;
CREATE POLICY "Allow read for authenticated" ON products
FOR SELECT USING (auth.role() = 'authenticated');

-- Política para que admins puedan administrar productos
DROP POLICY IF EXISTS "Allow all for admins" ON products;
CREATE POLICY "Allow all for admins" ON products
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('superadmin', 'admin_general')
  )
);

-- ========================================================
-- ✅ LISTO! Ahora ejecuta este archivo en Supabase
-- ========================================================

