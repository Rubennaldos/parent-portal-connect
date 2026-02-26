-- =====================================================
-- AGREGAR GUARNICIONES A MENÚS
-- =====================================================
-- Sistema simple para agregar guarniciones opcionales
-- a cada menú (ej: Papas fritas, Ensalada extra, etc.)
-- =====================================================

-- 1. Agregar columna garnishes en lunch_menus (JSONB array de strings)
ALTER TABLE lunch_menus
ADD COLUMN IF NOT EXISTS garnishes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN lunch_menus.garnishes IS 'Lista simple de guarniciones disponibles para este menú (ej: ["Papas fritas", "Ensalada extra", "Salsa extra"])';

-- 2. Agregar columna selected_garnishes en lunch_orders (JSONB array de strings)
ALTER TABLE lunch_orders
ADD COLUMN IF NOT EXISTS selected_garnishes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN lunch_orders.selected_garnishes IS 'Guarniciones seleccionadas por el padre/profesor al hacer el pedido';

-- 3. Índice para búsquedas (opcional, pero útil)
CREATE INDEX IF NOT EXISTS idx_lunch_menus_garnishes ON lunch_menus USING GIN (garnishes);
