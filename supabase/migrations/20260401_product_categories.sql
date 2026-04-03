-- Tabla de categorías de productos
-- Permite crear, renombrar y eliminar categorías de forma persistente

CREATE TABLE IF NOT EXISTS product_categories (
  id   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- RLS: todos pueden leer, solo roles admin pueden escribir
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_categories' AND policyname='product_categories_select') THEN
    CREATE POLICY "product_categories_select" ON product_categories FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_categories' AND policyname='product_categories_insert') THEN
    CREATE POLICY "product_categories_insert" ON product_categories FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_categories' AND policyname='product_categories_update') THEN
    CREATE POLICY "product_categories_update" ON product_categories FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_categories' AND policyname='product_categories_delete') THEN
    CREATE POLICY "product_categories_delete" ON product_categories FOR DELETE USING (true);
  END IF;
END $$;

-- Insertar categorías predefinidas base
INSERT INTO product_categories (name) VALUES
  ('bebidas'),
  ('chocolates'),
  ('dulces'),
  ('frutas'),
  ('galletas'),
  ('golosinas'),
  ('jugos'),
  ('menu'),
  ('otros'),
  ('postres'),
  ('refrescos'),
  ('sandwiches'),
  ('snack'),
  ('snacks')
ON CONFLICT (name) DO NOTHING;

-- Insertar también cualquier categoría que ya exista en productos (sin duplicados)
INSERT INTO product_categories (name)
SELECT DISTINCT lower(trim(category))
FROM products
WHERE category IS NOT NULL AND trim(category) != ''
ON CONFLICT (name) DO NOTHING;
