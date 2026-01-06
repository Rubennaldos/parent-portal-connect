-- Actualizar tabla products con TODOS los campos nuevos
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS price_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS price_sale DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS has_stock BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stock_initial INTEGER,
ADD COLUMN IF NOT EXISTS stock_min INTEGER,
ADD COLUMN IF NOT EXISTS has_expiry BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS expiry_days INTEGER,
ADD COLUMN IF NOT EXISTS has_igv BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS has_wholesale BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS wholesale_qty INTEGER,
ADD COLUMN IF NOT EXISTS wholesale_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS school_ids TEXT[];

-- Actualizar productos existentes
UPDATE products SET price_sale = price WHERE price_sale IS NULL AND price IS NOT NULL;
