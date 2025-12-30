-- ============================================
-- VERIFICAR TABLAS EXISTENTES Y CREAR FALTANTES
-- Para el módulo POS
-- ============================================

-- 1. TABLA: students (Estudiantes)
-- Verificar si existe, si no, crearla
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id UUID REFERENCES public.profiles(id),
  name VARCHAR(200) NOT NULL,
  photo_url TEXT,
  balance DECIMAL(10,2) DEFAULT 0.00,
  daily_limit DECIMAL(10,2) DEFAULT 10.00,
  grade VARCHAR(50),
  section VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. TABLA: products (Productos)
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  category VARCHAR(50), -- 'bebidas', 'snacks', 'menu'
  image_url TEXT,
  stock INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. TABLA: transactions (Transacciones)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES public.students(id),
  type VARCHAR(50) NOT NULL, -- 'purchase', 'recharge'
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  balance_after DECIMAL(10,2),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. TABLA: transaction_items (Items de cada transacción)
CREATE TABLE IF NOT EXISTS public.transaction_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  product_name VARCHAR(200),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_students_parent ON students(parent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_student ON transactions(student_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction ON transaction_items(transaction_id);

-- ============================================
-- DATOS DE PRUEBA (Solo si las tablas están vacías)
-- ============================================

-- Insertar estudiante de prueba "Pedrito"
INSERT INTO public.students (name, photo_url, balance, daily_limit, grade, section, is_active)
SELECT 
  'Pedro García',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Pedro',
  50.00,
  15.00,
  '3ro Primaria',
  'A',
  true
WHERE NOT EXISTS (SELECT 1 FROM public.students WHERE name = 'Pedro García');

-- Insertar más estudiantes de prueba
INSERT INTO public.students (name, photo_url, balance, daily_limit, grade, section, is_active)
SELECT * FROM (VALUES
  ('María López', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria', 35.00, 15.00, '4to Primaria', 'B', true),
  ('Juan Pérez', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Juan', 20.00, 15.00, '5to Primaria', 'A', true),
  ('Ana Torres', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ana', 5.00, 10.00, '2do Primaria', 'C', true)
) AS v(name, photo_url, balance, daily_limit, grade, section, is_active)
WHERE NOT EXISTS (SELECT 1 FROM public.students WHERE name = v.name);

-- Insertar productos de prueba
INSERT INTO public.products (name, description, price, category, image_url, stock, is_available)
SELECT * FROM (VALUES
  -- Bebidas
  ('Agua Mineral', 'Agua mineral 500ml', 2.00, 'bebidas', 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400', 50, true),
  ('Jugo de Naranja', 'Jugo natural 300ml', 3.50, 'bebidas', 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400', 30, true),
  ('Yogurt', 'Yogurt natural 200ml', 4.00, 'bebidas', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400', 25, true),
  
  -- Snacks
  ('Galletas', 'Galletas de chocolate', 2.50, 'snacks', 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400', 40, true),
  ('Papas Fritas', 'Papas fritas pequeñas', 3.00, 'snacks', 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400', 35, true),
  ('Frutas', 'Porción de frutas', 4.50, 'snacks', 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=400', 20, true),
  
  -- Menú
  ('Menú Completo', 'Menú del día', 8.00, 'menu', 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400', 15, true),
  ('Sandwich', 'Sandwich de pollo', 5.50, 'menu', 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400', 20, true),
  ('Pizza Personal', 'Pizza margarita', 7.00, 'menu', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400', 10, true)
) AS v(name, description, price, category, image_url, stock, is_available)
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE name = v.name);

-- Verificar datos creados
SELECT 'Estudiantes:' as tabla, COUNT(*) as total FROM public.students
UNION ALL
SELECT 'Productos:', COUNT(*) FROM public.products
UNION ALL
SELECT 'Transacciones:', COUNT(*) FROM public.transactions;

-- Ver estudiantes creados
SELECT id, name, balance, grade FROM public.students ORDER BY name;

-- Ver productos creados
SELECT id, name, price, category, stock FROM public.products ORDER BY category, name;


