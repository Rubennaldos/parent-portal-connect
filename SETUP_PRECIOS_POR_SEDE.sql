-- =============================================
-- SISTEMA DE PRECIOS DIFERENCIADOS POR SEDE
-- Permite que cada producto tenga precios distintos en cada colegio
-- =============================================

-- 1. Crear tabla de precios por sede (sobrescribe el precio base)
CREATE TABLE IF NOT EXISTS public.product_school_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  price_sale DECIMAL(10,2) NOT NULL, -- Precio de venta en esta sede
  price_cost DECIMAL(10,2), -- Precio de costo en esta sede (opcional)
  is_available BOOLEAN DEFAULT true, -- Si el producto está disponible en esta sede
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, school_id) -- Un producto solo puede tener un precio por sede
);

-- 2. Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_product_school_prices_product ON product_school_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_product_school_prices_school ON product_school_prices(school_id);
CREATE INDEX IF NOT EXISTS idx_product_school_prices_available ON product_school_prices(is_available);

-- 3. Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_product_school_prices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_product_school_prices_updated_at
BEFORE UPDATE ON product_school_prices
FOR EACH ROW
EXECUTE FUNCTION update_product_school_prices_updated_at();

-- 4. RLS (Row Level Security) para product_school_prices
ALTER TABLE product_school_prices ENABLE ROW LEVEL SECURITY;

-- Política: Admin General puede ver todo
CREATE POLICY "admin_general_can_view_all_prices"
ON product_school_prices FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
);

-- Política: Gestor de Unidad solo ve precios de su sede
CREATE POLICY "gestor_unidad_can_view_own_school_prices"
ON product_school_prices FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'gestor_unidad'
    AND profiles.school_id = product_school_prices.school_id
  )
);

-- Política: Admin General puede crear/actualizar precios
CREATE POLICY "admin_general_can_manage_prices"
ON product_school_prices FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- 5. Función auxiliar: Obtener precio de un producto en una sede específica
-- Si no existe precio específico, devuelve el precio base del producto
CREATE OR REPLACE FUNCTION get_product_price_for_school(
  p_product_id UUID,
  p_school_id UUID
)
RETURNS TABLE (
  price_sale DECIMAL(10,2),
  price_cost DECIMAL(10,2),
  is_available BOOLEAN,
  is_custom_price BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(psp.price_sale, p.price_sale) AS price_sale,
    COALESCE(psp.price_cost, p.price_cost) AS price_cost,
    COALESCE(psp.is_available, p.active) AS is_available,
    (psp.id IS NOT NULL) AS is_custom_price
  FROM products p
  LEFT JOIN product_school_prices psp 
    ON psp.product_id = p.id 
    AND psp.school_id = p_school_id
  WHERE p.id = p_product_id;
END;
$$ LANGUAGE plpgsql;

-- 6. Vista materializada para consultas rápidas en el POS
-- Esta vista combina productos con sus precios por sede
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_products_with_school_prices AS
SELECT 
  p.id AS product_id,
  p.name,
  p.code,
  p.category,
  p.price_sale AS base_price_sale,
  p.price_cost AS base_price_cost,
  p.active AS base_available,
  s.id AS school_id,
  s.name AS school_name,
  psp.price_sale AS custom_price_sale,
  psp.price_cost AS custom_price_cost,
  psp.is_available AS custom_available,
  COALESCE(psp.price_sale, p.price_sale) AS effective_price_sale,
  COALESCE(psp.price_cost, p.price_cost) AS effective_price_cost,
  COALESCE(psp.is_available, p.active) AS effective_available,
  (psp.id IS NOT NULL) AS has_custom_price
FROM products p
CROSS JOIN schools s
LEFT JOIN product_school_prices psp 
  ON psp.product_id = p.id 
  AND psp.school_id = s.id
WHERE p.active = true;

-- Índice en la vista materializada
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_products_schools 
ON mv_products_with_school_prices(product_id, school_id);

-- 7. Función para refrescar la vista materializada
CREATE OR REPLACE FUNCTION refresh_products_school_prices_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_products_with_school_prices;
END;
$$ LANGUAGE plpgsql;

-- 8. Agregar permiso al módulo de productos
INSERT INTO permissions (module, action, name, description) VALUES
('productos', 'gestionar_precios_sede', 'Gestionar Precios por Sede', 'Configurar precios diferenciados por sede')
ON CONFLICT (module, action) DO NOTHING;

-- Asignar permiso a Admin General
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 'admin_general', id, true 
FROM permissions 
WHERE module = 'productos' AND action = 'gestionar_precios_sede'
ON CONFLICT (role, permission_id) DO UPDATE SET granted = EXCLUDED.granted;

-- =============================================
-- COMENTARIOS Y DOCUMENTACIÓN
-- =============================================

COMMENT ON TABLE product_school_prices IS 'Precios personalizados de productos por sede. Si no existe un registro, se usa el precio base del producto.';
COMMENT ON COLUMN product_school_prices.is_available IS 'Permite deshabilitar un producto en una sede específica aunque esté activo globalmente.';
COMMENT ON FUNCTION get_product_price_for_school IS 'Devuelve el precio efectivo de un producto en una sede. Si existe precio personalizado, lo usa; si no, usa el precio base.';
COMMENT ON MATERIALIZED VIEW mv_products_with_school_prices IS 'Vista que combina todos los productos con todas las sedes y sus precios efectivos. Usar refresh_products_school_prices_view() después de cambios masivos.';

-- =============================================
-- PRUEBA DE FUNCIONAMIENTO
-- =============================================

-- Verificar que la tabla fue creada
SELECT 'Tabla product_school_prices creada correctamente' AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'product_school_prices'
);

-- Verificar función
SELECT 'Función get_product_price_for_school disponible' AS status
WHERE EXISTS (
  SELECT 1 FROM pg_proc 
  WHERE proname = 'get_product_price_for_school'
);

-- Mostrar estructura de la vista materializada
SELECT 
  count(*) AS total_combinaciones_producto_sede,
  count(DISTINCT product_id) AS total_productos,
  count(DISTINCT school_id) AS total_sedes
FROM mv_products_with_school_prices;
