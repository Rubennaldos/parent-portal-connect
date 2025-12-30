-- ========================================================
-- PRODUCTOS MOCK PARA PRUEBAS - PUNTO DE VENTA
-- ========================================================
-- Este archivo contiene productos de prueba para el módulo POS
-- Puedes ejecutar todo el script de una vez
-- ========================================================

-- ========================================================
-- 1. CREAR/VERIFICAR TABLA PRODUCTS
-- ========================================================

CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    category TEXT NOT NULL,
    image_url TEXT,
    stock INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================================================
-- 2. LIMPIAR PRODUCTOS ANTERIORES (OPCIONAL)
-- ========================================================
-- Descomenta si quieres empezar desde cero
-- DELETE FROM products;

-- ========================================================
-- 3. INSERTAR PRODUCTOS MOCK
-- ========================================================

-- BEBIDAS
INSERT INTO products (name, description, price, category, image_url, stock, is_active) VALUES
('Agua Mineral 500ml', 'Agua San Luis sin gas', 2.00, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=agua', 100, true),
('Coca Cola 500ml', 'Coca Cola personal', 3.50, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=coca', 80, true),
('Inca Kola 500ml', 'Inca Kola personal', 3.50, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=inca', 80, true),
('Jugo de Naranja', 'Jugo natural de naranja 300ml', 4.50, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=jugo', 50, true),
('Chicha Morada', 'Chicha morada casera 300ml', 3.00, 'bebidas', 'https://api.dicebear.com/7.x/shapes/svg?seed=chicha', 40, true);

-- SNACKS
INSERT INTO products (name, description, price, category, image_url, stock, is_active) VALUES
('Papas Lays', 'Papas fritas sabor clásico', 2.50, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=papas', 120, true),
('Piqueo', 'Mix de maní, pasas y chocolate', 3.00, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=piqueo', 90, true),
('Galletas Oreo', 'Galletas Oreo paquete individual', 2.00, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=oreo', 100, true),
('Chocosoda', 'Galletas Chocosoda paquete', 1.50, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=choco', 110, true),
('Sublime', 'Chocolate Sublime con maní', 2.50, 'snacks', 'https://api.dicebear.com/7.x/shapes/svg?seed=sublime', 95, true);

-- MENÚ (Comida caliente)
INSERT INTO products (name, description, price, category, image_url, stock, is_active) VALUES
('Sándwich de Pollo', 'Sándwich de pollo con lechuga y tomate', 8.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=sandwich', 30, true),
('Hamburguesa', 'Hamburguesa con queso y papas', 10.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=burger', 25, true),
('Hot Dog', 'Hot dog con papas fritas', 7.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=hotdog', 35, true),
('Pizza Personal', 'Pizza personal de jamón y queso', 9.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=pizza', 20, true),
('Salchipapa', 'Salchipapas con salsas', 6.50, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=salchi', 40, true),
('Empanada de Carne', 'Empanada de carne jugosa', 4.00, 'menu', 'https://api.dicebear.com/7.x/shapes/svg?seed=empanada', 50, true);

-- ========================================================
-- 4. ACTIVAR RLS (Row Level Security)
-- ========================================================

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Policy: Todos pueden ver productos activos
CREATE POLICY "Todos pueden ver productos activos" ON public.products
FOR SELECT USING (is_active = true);

-- Policy: Solo staff puede insertar/actualizar/eliminar
CREATE POLICY "Solo staff puede modificar productos" ON public.products
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND role IN ('superadmin', 'admin_general', 'pos', 'kitchen')
    )
);

-- ========================================================
-- 5. VERIFICAR PRODUCTOS INSERTADOS
-- ========================================================

SELECT 
    category,
    COUNT(*) as cantidad,
    SUM(stock) as stock_total
FROM products
WHERE is_active = true
GROUP BY category
ORDER BY category;

-- ========================================================
-- 6. VER TODOS LOS PRODUCTOS
-- ========================================================

SELECT 
    name,
    price,
    category,
    stock,
    is_active
FROM products
ORDER BY category, price;

-- ========================================================
-- 🗑️ PARA BORRAR TODOS LOS PRODUCTOS MOCK
-- ========================================================
-- Ejecuta esto cuando quieras limpiar:

/*
DELETE FROM products;

-- O si quieres borrar solo los mock y dejar los reales:
DELETE FROM products 
WHERE description LIKE '%mock%' 
OR image_url LIKE '%dicebear%';
*/

-- ========================================================
-- 📝 NOTAS
-- ========================================================
/*
✅ Productos creados:
   - 5 Bebidas (S/ 2.00 - S/ 4.50)
   - 5 Snacks (S/ 1.50 - S/ 3.00)
   - 6 Menú (S/ 4.00 - S/ 10.00)
   
🎯 Total: 16 productos mock

🖼️ Imágenes: Usando dicebear para avatares únicos
   (Puedes reemplazar con URLs reales después)

🗑️ Para borrar: Ejecuta la sección "PARA BORRAR"
*/

