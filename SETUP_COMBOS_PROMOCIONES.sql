-- =============================================
-- SISTEMA DE COMBOS Y PROMOCIONES
-- =============================================

-- 1. TABLA: combos
-- Combos = Varios productos juntos con precio especial
CREATE TABLE IF NOT EXISTS public.combos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  combo_price DECIMAL(10,2) NOT NULL,
  image_url TEXT,
  active BOOLEAN DEFAULT true,
  valid_from DATE,
  valid_until DATE,
  school_ids TEXT[], -- Sedes donde aplica el combo
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA: combo_items
-- Productos que conforman cada combo
CREATE TABLE IF NOT EXISTS public.combo_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id UUID NOT NULL REFERENCES public.combos(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA: promotions
-- Promociones = Descuentos sobre productos o categorías
CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  discount_type VARCHAR(20) NOT NULL, -- 'percentage' o 'fixed'
  discount_value DECIMAL(10,2) NOT NULL,
  applies_to VARCHAR(20) NOT NULL, -- 'product', 'category', 'all'
  target_ids TEXT[], -- IDs de productos o categorías (null si applies_to='all')
  active BOOLEAN DEFAULT true,
  valid_from DATE,
  valid_until DATE,
  school_ids TEXT[], -- Sedes donde aplica
  priority INTEGER DEFAULT 0, -- Para resolver conflictos si hay múltiples promos
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ÍNDICES para rendimiento
CREATE INDEX IF NOT EXISTS idx_combos_active ON combos(active);
CREATE INDEX IF NOT EXISTS idx_combos_valid ON combos(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON combo_items(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_product ON combo_items(product_id);
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(active);
CREATE INDEX IF NOT EXISTS idx_promotions_valid ON promotions(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_promotions_applies ON promotions(applies_to);

-- 5. TRIGGERS para updated_at
CREATE OR REPLACE FUNCTION update_combos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_combos_updated_at ON combos;
CREATE TRIGGER trigger_update_combos_updated_at
BEFORE UPDATE ON combos
FOR EACH ROW
EXECUTE FUNCTION update_combos_updated_at();

CREATE OR REPLACE FUNCTION update_promotions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_promotions_updated_at ON promotions;
CREATE TRIGGER trigger_update_promotions_updated_at
BEFORE UPDATE ON promotions
FOR EACH ROW
EXECUTE FUNCTION update_promotions_updated_at();

-- 6. RLS (Row Level Security)
ALTER TABLE combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

-- Políticas para combos
CREATE POLICY "admin_can_view_all_combos"
ON combos FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
  )
);

CREATE POLICY "admin_can_manage_combos"
ON combos FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- Políticas para combo_items
CREATE POLICY "admin_can_view_combo_items"
ON combo_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad', 'operador_caja')
  )
);

CREATE POLICY "admin_can_manage_combo_items"
ON combo_items FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- Políticas para promotions
CREATE POLICY "admin_can_view_promotions"
ON promotions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad', 'operador_caja')
  )
);

CREATE POLICY "admin_can_manage_promotions"
ON promotions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- 7. FUNCIÓN: Obtener combos activos para una sede
CREATE OR REPLACE FUNCTION get_active_combos_for_school(p_school_id UUID)
RETURNS TABLE (
  combo_id UUID,
  combo_name VARCHAR,
  combo_description TEXT,
  combo_price DECIMAL,
  combo_image_url TEXT,
  products JSON
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.description,
    c.combo_price,
    c.image_url,
    json_agg(
      json_build_object(
        'product_id', ci.product_id,
        'product_name', p.name,
        'quantity', ci.quantity,
        'has_stock', p.has_stock,
        'price', p.price_sale
      )
    ) AS products
  FROM combos c
  JOIN combo_items ci ON ci.combo_id = c.id
  JOIN products p ON p.id = ci.product_id
  WHERE c.active = true
    AND (c.valid_from IS NULL OR c.valid_from <= CURRENT_DATE)
    AND (c.valid_until IS NULL OR c.valid_until >= CURRENT_DATE)
    AND (p_school_id = ANY(c.school_ids) OR c.school_ids IS NULL OR array_length(c.school_ids, 1) IS NULL)
  GROUP BY c.id, c.name, c.description, c.combo_price, c.image_url;
END;
$$ LANGUAGE plpgsql;

-- 8. FUNCIÓN: Obtener promociones activas
CREATE OR REPLACE FUNCTION get_active_promotions_for_school(p_school_id UUID)
RETURNS TABLE (
  promotion_id UUID,
  promotion_name VARCHAR,
  discount_type VARCHAR,
  discount_value DECIMAL,
  applies_to VARCHAR,
  target_ids TEXT[],
  priority INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.id,
    pr.name,
    pr.discount_type,
    pr.discount_value,
    pr.applies_to,
    pr.target_ids,
    pr.priority
  FROM promotions pr
  WHERE pr.active = true
    AND (pr.valid_from IS NULL OR pr.valid_from <= CURRENT_DATE)
    AND (pr.valid_until IS NULL OR pr.valid_until >= CURRENT_DATE)
    AND (p_school_id = ANY(pr.school_ids) OR pr.school_ids IS NULL OR array_length(pr.school_ids, 1) IS NULL)
  ORDER BY pr.priority DESC;
END;
$$ LANGUAGE plpgsql;

-- 9. FUNCIÓN: Calcular precio con descuento
CREATE OR REPLACE FUNCTION calculate_discounted_price(
  p_product_id UUID,
  p_original_price DECIMAL,
  p_category VARCHAR,
  p_school_id UUID
)
RETURNS DECIMAL AS $$
DECLARE
  v_best_discount DECIMAL := 0;
  v_promo RECORD;
BEGIN
  -- Buscar la mejor promoción aplicable
  FOR v_promo IN 
    SELECT * FROM get_active_promotions_for_school(p_school_id)
  LOOP
    -- Promoción sobre producto específico
    IF v_promo.applies_to = 'product' AND p_product_id::TEXT = ANY(v_promo.target_ids) THEN
      IF v_promo.discount_type = 'percentage' THEN
        v_best_discount := GREATEST(v_best_discount, p_original_price * (v_promo.discount_value / 100));
      ELSE
        v_best_discount := GREATEST(v_best_discount, v_promo.discount_value);
      END IF;
    END IF;
    
    -- Promoción sobre categoría
    IF v_promo.applies_to = 'category' AND p_category = ANY(v_promo.target_ids) THEN
      IF v_promo.discount_type = 'percentage' THEN
        v_best_discount := GREATEST(v_best_discount, p_original_price * (v_promo.discount_value / 100));
      ELSE
        v_best_discount := GREATEST(v_best_discount, v_promo.discount_value);
      END IF;
    END IF;
    
    -- Promoción sobre todos los productos
    IF v_promo.applies_to = 'all' THEN
      IF v_promo.discount_type = 'percentage' THEN
        v_best_discount := GREATEST(v_best_discount, p_original_price * (v_promo.discount_value / 100));
      ELSE
        v_best_discount := GREATEST(v_best_discount, v_promo.discount_value);
      END IF;
    END IF;
  END LOOP;
  
  RETURN GREATEST(p_original_price - v_best_discount, 0);
END;
$$ LANGUAGE plpgsql;

-- 10. COMENTARIOS de documentación
COMMENT ON TABLE combos IS 'Combos: agrupación de productos con precio especial';
COMMENT ON TABLE combo_items IS 'Productos que conforman cada combo con sus cantidades';
COMMENT ON TABLE promotions IS 'Promociones/descuentos sobre productos, categorías o todo el catálogo';
COMMENT ON FUNCTION get_active_combos_for_school IS 'Obtiene combos vigentes para una sede específica';
COMMENT ON FUNCTION get_active_promotions_for_school IS 'Obtiene promociones vigentes para una sede';
COMMENT ON FUNCTION calculate_discounted_price IS 'Calcula el precio final de un producto aplicando la mejor promoción disponible';

-- 11. DATOS DE EJEMPLO (comentados, descomentar para testing)
/*
-- Ejemplo de Combo: "Combo Estudiante"
INSERT INTO combos (name, description, combo_price, active, school_ids) VALUES
('Combo Estudiante', 'Sándwich + Gaseosa', 5.00, true, ARRAY['sede-uuid-1', 'sede-uuid-2']);

-- Ejemplo de Promoción: "20% en todos los sándwiches"
INSERT INTO promotions (name, description, discount_type, discount_value, applies_to, target_ids, active) VALUES
('Descuento Sándwiches', 'Todos los sándwiches con 20% de descuento', 'percentage', 20.00, 'category', ARRAY['sandwiches'], true);
*/

-- 12. VERIFICACIÓN
SELECT 'Tablas de combos y promociones creadas correctamente' AS status;
