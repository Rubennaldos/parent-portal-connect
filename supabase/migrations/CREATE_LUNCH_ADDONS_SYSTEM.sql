-- =====================================================
-- SISTEMA DE AGREGADOS Y VENTA DE COCINA
-- =====================================================
-- Creado: 2026-02-09
-- Descripción: Sistema para agregar toppings/extras a menús
--              y crear categoría de "Venta de Cocina"
-- =====================================================

-- 1. Agregar campo para identificar categorías de "Venta de Cocina"
-- Primero, permitir que school_id sea NULL para categorías globales
ALTER TABLE lunch_categories 
ALTER COLUMN school_id DROP NOT NULL;

ALTER TABLE lunch_categories 
ADD COLUMN IF NOT EXISTS is_kitchen_sale BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS allows_addons BOOLEAN DEFAULT true;

COMMENT ON COLUMN lunch_categories.is_kitchen_sale IS 'Indica si esta categoría es para venta de productos individuales de cocina (no menús completos)';
COMMENT ON COLUMN lunch_categories.allows_addons IS 'Indica si esta categoría permite agregar extras/toppings';

-- 2. Crear tabla de agregados por categoría
CREATE TABLE IF NOT EXISTS lunch_category_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES lunch_categories(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE lunch_category_addons IS 'Agregados/extras disponibles para cada categoría de menú (ej: doble porción, extras)';

CREATE INDEX idx_lunch_category_addons_category ON lunch_category_addons(category_id);
CREATE INDEX idx_lunch_category_addons_active ON lunch_category_addons(is_active);

-- 3. Crear tabla para relacionar pedidos con agregados seleccionados
CREATE TABLE IF NOT EXISTS lunch_order_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES lunch_orders(id) ON DELETE CASCADE,
  addon_id UUID NOT NULL REFERENCES lunch_category_addons(id),
  addon_name VARCHAR(100) NOT NULL, -- Guardamos el nombre por si se modifica después
  addon_price DECIMAL(10,2) NOT NULL, -- Guardamos el precio por si se modifica después
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  subtotal DECIMAL(10,2) NOT NULL, -- addon_price * quantity
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE lunch_order_addons IS 'Agregados seleccionados en cada pedido de almuerzo';

CREATE INDEX idx_lunch_order_addons_order ON lunch_order_addons(order_id);
CREATE INDEX idx_lunch_order_addons_addon ON lunch_order_addons(addon_id);

-- 4. Agregar campo en lunch_orders para almacenar el total con agregados
ALTER TABLE lunch_orders 
ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS addons_total DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS final_price DECIMAL(10,2) DEFAULT 0;

COMMENT ON COLUMN lunch_orders.base_price IS 'Precio base del menú (sin agregados)';
COMMENT ON COLUMN lunch_orders.addons_total IS 'Total de agregados seleccionados';
COMMENT ON COLUMN lunch_orders.final_price IS 'Precio final = base_price + addons_total';

-- 5. Modificar lunch_menus para soportar productos de cocina
ALTER TABLE lunch_menus
ADD COLUMN IF NOT EXISTS is_kitchen_product BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS product_name VARCHAR(200),
ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2);

COMMENT ON COLUMN lunch_menus.is_kitchen_product IS 'Indica si este menú es realmente un producto individual de cocina';
COMMENT ON COLUMN lunch_menus.product_name IS 'Nombre del producto (solo para venta de cocina)';
COMMENT ON COLUMN lunch_menus.product_price IS 'Precio del producto (solo para venta de cocina)';

-- 6. RLS Policies para lunch_category_addons
ALTER TABLE lunch_category_addons ENABLE ROW LEVEL SECURITY;

-- Policy: Ver agregados activos (todos los usuarios autenticados)
CREATE POLICY "anyone_view_active_addons" ON lunch_category_addons
  FOR SELECT
  USING (
    auth.role() = 'authenticated' 
    AND is_active = true
  );

-- Policy: Administradores pueden gestionar agregados
CREATE POLICY "admins_manage_addons" ON lunch_category_addons
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'gestor_unidad', 'admin_sede', 'supervisor_red')
    )
  );

-- 7. RLS Policies para lunch_order_addons
ALTER TABLE lunch_order_addons ENABLE ROW LEVEL SECURITY;

-- Policy: Ver agregados de pedidos propios
CREATE POLICY "view_own_order_addons" ON lunch_order_addons
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lunch_orders lo
      WHERE lo.id = lunch_order_addons.order_id
      AND (
        -- Pedidos de profesores
        lo.teacher_id = auth.uid()
        OR
        -- Pedidos de estudiantes (verificar a través de parent_profiles)
        lo.student_id IN (
          SELECT s.id FROM students s
          INNER JOIN parent_profiles pp ON pp.id = s.parent_id
          WHERE pp.user_id = auth.uid()
        )
      )
    )
  );

-- Policy: Administradores pueden ver todos los agregados de pedidos
CREATE POLICY "admins_view_all_order_addons" ON lunch_order_addons
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'gestor_unidad', 'admin_sede', 'supervisor_red', 'operador_caja')
    )
  );

-- Policy: Crear agregados en pedidos propios
CREATE POLICY "create_own_order_addons" ON lunch_order_addons
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lunch_orders lo
      WHERE lo.id = lunch_order_addons.order_id
      AND (
        -- Pedidos de profesores
        lo.teacher_id = auth.uid()
        OR
        -- Pedidos de estudiantes (verificar a través de parent_profiles)
        lo.student_id IN (
          SELECT s.id FROM students s
          INNER JOIN parent_profiles pp ON pp.id = s.parent_id
          WHERE pp.user_id = auth.uid()
        )
      )
    )
  );

-- 8. Función para calcular precio total del pedido con agregados
CREATE OR REPLACE FUNCTION calculate_order_final_price(p_order_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_base_price DECIMAL(10,2);
  v_addons_total DECIMAL(10,2);
  v_final_price DECIMAL(10,2);
BEGIN
  -- Obtener precio base
  SELECT COALESCE(base_price, 0) INTO v_base_price
  FROM lunch_orders
  WHERE id = p_order_id;
  
  -- Calcular total de agregados
  SELECT COALESCE(SUM(subtotal), 0) INTO v_addons_total
  FROM lunch_order_addons
  WHERE order_id = p_order_id;
  
  -- Calcular precio final
  v_final_price := v_base_price + v_addons_total;
  
  -- Actualizar el pedido
  UPDATE lunch_orders
  SET 
    addons_total = v_addons_total,
    final_price = v_final_price,
    updated_at = NOW()
  WHERE id = p_order_id;
  
  RETURN v_final_price;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_order_final_price IS 'Calcula y actualiza el precio final de un pedido incluyendo agregados';

-- 9. Trigger para actualizar precio cuando se agregan/eliminan agregados
CREATE OR REPLACE FUNCTION trigger_update_order_price()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalcular precio del pedido
  PERFORM calculate_order_final_price(
    CASE 
      WHEN TG_OP = 'DELETE' THEN OLD.order_id
      ELSE NEW.order_id
    END
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_order_price_on_addon_change ON lunch_order_addons;
CREATE TRIGGER update_order_price_on_addon_change
  AFTER INSERT OR UPDATE OR DELETE ON lunch_order_addons
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_order_price();

-- 10. Insertar datos de ejemplo: Categoría "Venta de Cocina"
-- (Solo si no existe)
-- Asumiendo que target_type puede ser 'both' (profesores y estudiantes)
INSERT INTO lunch_categories (name, description, target_type, is_kitchen_sale, allows_addons, is_active, display_order)
SELECT 
  'Venta de Cocina',
  'Productos individuales disponibles en cocina (arroz, bebidas, ensaladas, etc.)',
  'both', -- Disponible para profesores y estudiantes
  true,
  false, -- Los productos de cocina NO tienen agregados
  true,
  100 -- Al final de la lista
WHERE NOT EXISTS (
  SELECT 1 FROM lunch_categories WHERE is_kitchen_sale = true
);

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
