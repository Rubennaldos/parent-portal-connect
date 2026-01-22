-- ============================================
-- AGREGAR COLUMNA DESCRIPTION A PRODUCTS
-- Agregar campo de descripción a la tabla products
-- ============================================

-- Verificar si la columna ya existe antes de agregarla
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'products' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE public.products 
        ADD COLUMN description TEXT;
        
        RAISE NOTICE 'Columna "description" agregada exitosamente a la tabla products';
    ELSE
        RAISE NOTICE 'La columna "description" ya existe en la tabla products';
    END IF;
END $$;

-- Comentario en la columna
COMMENT ON COLUMN public.products.description IS 'Descripción del producto explicando sus cualidades y características';
