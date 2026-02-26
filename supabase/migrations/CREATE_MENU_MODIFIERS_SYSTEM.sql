-- =====================================================
-- SISTEMA DE MODIFICADORES DE MENÚ (Personalización)
-- =====================================================
-- Permite a los padres/profesores personalizar sus pedidos
-- cambiando componentes del menú (proteína, acompañamiento, etc.)
-- SIN CAMBIAR EL PRECIO.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. Agregar columna allows_modifiers en lunch_menus
--    Por defecto FALSE (desactivado). El admin lo activa.
-- ─────────────────────────────────────────────────────
ALTER TABLE lunch_menus
ADD COLUMN IF NOT EXISTS allows_modifiers BOOLEAN DEFAULT false;

COMMENT ON COLUMN lunch_menus.allows_modifiers IS 'Indica si este menú permite personalización por el padre/profesor. Desactivado por defecto.';

-- ─────────────────────────────────────────────────────
-- 2. Tabla de grupos de modificadores por menú
--    Ej: "Proteína", "Acompañamiento", "Ensalada"
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_modifier_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES lunch_menus(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,           -- Ej: "Proteína", "Acompañamiento"
  is_required BOOLEAN DEFAULT true,     -- ¿Debe elegir sí o sí?
  max_selections INTEGER DEFAULT 1,     -- Cuántas opciones puede elegir (normalmente 1)
  display_order INTEGER DEFAULT 0,      -- Orden visual
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE menu_modifier_groups IS 'Grupos de personalización para un menú (ej: Proteína, Acompañamiento, Ensalada). Todo es mismo precio.';

CREATE INDEX IF NOT EXISTS idx_modifier_groups_menu ON menu_modifier_groups(menu_id);
CREATE INDEX IF NOT EXISTS idx_modifier_groups_order ON menu_modifier_groups(display_order);

-- ─────────────────────────────────────────────────────
-- 3. Tabla de opciones dentro de cada grupo
--    Ej: Dentro de "Proteína" → Pollo, Pescado, Res
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_modifier_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES menu_modifier_groups(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,           -- Ej: "Pollo", "Pescado", "Sin ensalada"
  is_default BOOLEAN DEFAULT false,     -- ¿Es la opción por defecto?
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE menu_modifier_options IS 'Opciones dentro de un grupo de modificadores (ej: Pollo, Pescado, Res dentro del grupo Proteína)';

CREATE INDEX IF NOT EXISTS idx_modifier_options_group ON menu_modifier_options(group_id);
CREATE INDEX IF NOT EXISTS idx_modifier_options_default ON menu_modifier_options(is_default);

-- ─────────────────────────────────────────────────────
-- 4. Agregar columna selected_modifiers en lunch_orders
--    Guarda las personalizaciones elegidas como JSONB
--    Formato: [{"group_name": "Proteína", "selected": "Pescado"}, ...]
-- ─────────────────────────────────────────────────────
ALTER TABLE lunch_orders
ADD COLUMN IF NOT EXISTS selected_modifiers JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN lunch_orders.selected_modifiers IS 'Personalizaciones elegidas por el padre/profesor. Formato: [{"group_id":"...", "group_name":"Proteína", "selected_option_id":"...", "selected_name":"Pescado"}]';

-- ─────────────────────────────────────────────────────
-- 5. Tabla de favoritos por estudiante/profesor
--    "Mi Platito Favorito" - guarda combinaciones preferidas
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modifier_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE, -- NULL si es profesor
  category_id UUID NOT NULL REFERENCES lunch_categories(id) ON DELETE CASCADE,
  favorite_name VARCHAR(100) DEFAULT 'Mi Favorito', -- Nombre personalizable
  modifiers JSONB NOT NULL DEFAULT '[]'::jsonb,     -- Misma estructura que selected_modifiers
  use_count INTEGER DEFAULT 0,                       -- Cuántas veces se ha usado
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE modifier_favorites IS 'Combinaciones favoritas de personalización por estudiante/profesor. "Mi Platito Favorito"';

CREATE INDEX IF NOT EXISTS idx_modifier_favs_user ON modifier_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_modifier_favs_student ON modifier_favorites(student_id);
CREATE INDEX IF NOT EXISTS idx_modifier_favs_category ON modifier_favorites(category_id);

-- ─────────────────────────────────────────────────────
-- 6. RLS Policies para menu_modifier_groups
-- ─────────────────────────────────────────────────────
ALTER TABLE menu_modifier_groups ENABLE ROW LEVEL SECURITY;

-- Todos los autenticados pueden ver los grupos
CREATE POLICY "authenticated_view_modifier_groups" ON menu_modifier_groups
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Solo admin/gestor pueden gestionar grupos
CREATE POLICY "admins_manage_modifier_groups" ON menu_modifier_groups
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'super_admin', 'gestor_unidad', 'admin_sede')
    )
  );

-- ─────────────────────────────────────────────────────
-- 7. RLS Policies para menu_modifier_options
-- ─────────────────────────────────────────────────────
ALTER TABLE menu_modifier_options ENABLE ROW LEVEL SECURITY;

-- Todos los autenticados pueden ver las opciones
CREATE POLICY "authenticated_view_modifier_options" ON menu_modifier_options
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Solo admin/gestor pueden gestionar opciones
CREATE POLICY "admins_manage_modifier_options" ON menu_modifier_options
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'super_admin', 'gestor_unidad', 'admin_sede')
    )
  );

-- ─────────────────────────────────────────────────────
-- 8. RLS Policies para modifier_favorites
-- ─────────────────────────────────────────────────────
ALTER TABLE modifier_favorites ENABLE ROW LEVEL SECURITY;

-- Usuarios ven sus propios favoritos
CREATE POLICY "users_view_own_favorites" ON modifier_favorites
  FOR SELECT
  USING (auth.uid() = user_id);

-- Usuarios crean sus propios favoritos
CREATE POLICY "users_create_own_favorites" ON modifier_favorites
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Usuarios actualizan sus propios favoritos
CREATE POLICY "users_update_own_favorites" ON modifier_favorites
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Usuarios eliminan sus propios favoritos
CREATE POLICY "users_delete_own_favorites" ON modifier_favorites
  FOR DELETE
  USING (auth.uid() = user_id);

-- Admins pueden ver todos los favoritos (para estadísticas)
CREATE POLICY "admins_view_all_favorites" ON modifier_favorites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'super_admin', 'gestor_unidad')
    )
  );

-- ─────────────────────────────────────────────────────
-- 9. Triggers para updated_at
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_modifier_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER modifier_groups_updated_at
  BEFORE UPDATE ON menu_modifier_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_modifier_groups_updated_at();

CREATE OR REPLACE FUNCTION update_modifier_favorites_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER modifier_favorites_updated_at
  BEFORE UPDATE ON modifier_favorites
  FOR EACH ROW
  EXECUTE FUNCTION update_modifier_favorites_updated_at();

-- ─────────────────────────────────────────────────────
-- 10. Función para obtener estadísticas de preferencias
--     Usada por el dashboard de "Estadísticas de Preferencias"
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_modifier_stats(
  p_school_id UUID,
  p_date_from DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
  p_date_to DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  group_name TEXT,
  option_name TEXT,
  order_count BIGINT,
  percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH modifier_data AS (
    SELECT
      (elem->>'group_name')::TEXT AS g_name,
      (elem->>'selected_name')::TEXT AS o_name
    FROM lunch_orders lo,
         jsonb_array_elements(lo.selected_modifiers) AS elem
    WHERE lo.school_id = p_school_id
      AND lo.order_date BETWEEN p_date_from AND p_date_to
      AND lo.is_cancelled = false
      AND jsonb_array_length(lo.selected_modifiers) > 0
  ),
  counted AS (
    SELECT
      g_name,
      o_name,
      COUNT(*) AS cnt
    FROM modifier_data
    GROUP BY g_name, o_name
  ),
  totals AS (
    SELECT
      g_name,
      SUM(cnt) AS total
    FROM counted
    GROUP BY g_name
  )
  SELECT
    c.g_name AS group_name,
    c.o_name AS option_name,
    c.cnt AS order_count,
    ROUND((c.cnt::NUMERIC / t.total::NUMERIC) * 100, 1) AS percentage
  FROM counted c
  JOIN totals t ON c.g_name = t.g_name
  ORDER BY c.g_name, c.cnt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_modifier_stats IS 'Retorna estadísticas de preferencias de personalización por escuela y rango de fechas';

-- ─────────────────────────────────────────────────────
-- 11. Vista para cocina: pedidos agrupados por variación
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_kitchen_orders_summary(
  p_school_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  category_name TEXT,
  menu_main_course TEXT,
  modifiers_summary TEXT,
  order_count BIGINT,
  order_ids UUID[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    lc.name::TEXT AS category_name,
    lm.main_course::TEXT AS menu_main_course,
    CASE
      WHEN jsonb_array_length(COALESCE(lo.selected_modifiers, '[]'::jsonb)) = 0
      THEN 'Estándar (sin cambios)'::TEXT
      ELSE (
        SELECT string_agg(
          (elem->>'group_name') || ': ' || (elem->>'selected_name'),
          ' | '
        )
        FROM jsonb_array_elements(lo.selected_modifiers) AS elem
      )
    END AS modifiers_summary,
    COUNT(*)::BIGINT AS order_count,
    ARRAY_AGG(lo.id) AS order_ids
  FROM lunch_orders lo
  JOIN lunch_categories lc ON lc.id = lo.category_id
  LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
  WHERE lo.school_id = p_school_id
    AND lo.order_date = p_date
    AND lo.is_cancelled = false
    AND lo.status NOT IN ('cancelled')
  GROUP BY lc.name, lm.main_course, 
    CASE
      WHEN jsonb_array_length(COALESCE(lo.selected_modifiers, '[]'::jsonb)) = 0
      THEN 'Estándar (sin cambios)'::TEXT
      ELSE (
        SELECT string_agg(
          (elem->>'group_name') || ': ' || (elem->>'selected_name'),
          ' | '
        )
        FROM jsonb_array_elements(lo.selected_modifiers) AS elem
      )
    END
  ORDER BY lc.name, order_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_kitchen_orders_summary IS 'Vista Cocina: pedidos del día agrupados por categoría, menú y personalización';

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
SELECT '✅ Sistema de Modificadores de Menú creado exitosamente' AS resultado;
