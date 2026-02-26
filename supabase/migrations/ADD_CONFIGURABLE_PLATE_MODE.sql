-- ============================================================
-- MIGRACIÓN: Agregar modo "Plato Configurable" a categorías
-- ============================================================
-- Permite que una categoría funcione como plato configurable
-- donde el padre elige opciones (proteína, guarnición, etc.)
-- en vez del menú tradicional (Entrada, Segundo, Bebida, Postre).
-- ============================================================

-- 1. Agregar campo menu_mode a lunch_categories
--    'standard'     = Menú tradicional (Entrada, Segundo, Bebida, Postre)
--    'configurable' = Plato configurable (grupos de opciones: Proteína, Guarnición, etc.)
ALTER TABLE lunch_categories
ADD COLUMN IF NOT EXISTS menu_mode TEXT NOT NULL DEFAULT 'standard';

-- 2. Agregar constraint para valores válidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lunch_categories_menu_mode_check'
  ) THEN
    ALTER TABLE lunch_categories
    ADD CONSTRAINT lunch_categories_menu_mode_check
    CHECK (menu_mode IN ('standard', 'configurable'));
  END IF;
END $$;

-- 3. Crear tabla para grupos de opciones de platos configurables
--    Ejemplo: "Proteína", "Guarnición", "Ensalada"
CREATE TABLE IF NOT EXISTS configurable_plate_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES lunch_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- "Proteína", "Guarnición", etc.
  is_required BOOLEAN DEFAULT true,      -- ¿Es obligatorio elegir?
  max_selections INTEGER DEFAULT 1,      -- Cuántas opciones puede elegir (1 = elige una)
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Crear tabla para opciones dentro de cada grupo
--    Ejemplo: Grupo "Proteína" → Pollo a la plancha, Filete de pescado, Carne magra
CREATE TABLE IF NOT EXISTS configurable_plate_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES configurable_plate_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- "Pollo a la plancha"
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Agregar columna para guardar selecciones del plato configurable en pedidos
--    Formato JSONB: [{"group_name": "Proteína", "selected": "Pollo"}, {"group_name": "Guarnición", "selected": "Ensalada"}]
ALTER TABLE lunch_orders
ADD COLUMN IF NOT EXISTS configurable_selections JSONB DEFAULT '[]'::jsonb;

-- 6. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_configurable_plate_groups_category
  ON configurable_plate_groups(category_id);

CREATE INDEX IF NOT EXISTS idx_configurable_plate_options_group
  ON configurable_plate_options(group_id);

CREATE INDEX IF NOT EXISTS idx_lunch_categories_menu_mode
  ON lunch_categories(menu_mode);

-- 7. RLS (Row Level Security)
ALTER TABLE configurable_plate_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurable_plate_options ENABLE ROW LEVEL SECURITY;

-- Políticas para configurable_plate_groups
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_groups_select') THEN
    CREATE POLICY configurable_plate_groups_select ON configurable_plate_groups
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_groups_insert') THEN
    CREATE POLICY configurable_plate_groups_insert ON configurable_plate_groups
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_groups_update') THEN
    CREATE POLICY configurable_plate_groups_update ON configurable_plate_groups
      FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_groups_delete') THEN
    CREATE POLICY configurable_plate_groups_delete ON configurable_plate_groups
      FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- Políticas para configurable_plate_options
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_options_select') THEN
    CREATE POLICY configurable_plate_options_select ON configurable_plate_options
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_options_insert') THEN
    CREATE POLICY configurable_plate_options_insert ON configurable_plate_options
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_options_update') THEN
    CREATE POLICY configurable_plate_options_update ON configurable_plate_options
      FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'configurable_plate_options_delete') THEN
    CREATE POLICY configurable_plate_options_delete ON configurable_plate_options
      FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- 8. Trigger para updated_at
CREATE OR REPLACE FUNCTION update_configurable_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS configurable_plate_groups_updated_at ON configurable_plate_groups;
CREATE TRIGGER configurable_plate_groups_updated_at
  BEFORE UPDATE ON configurable_plate_groups
  FOR EACH ROW EXECUTE FUNCTION update_configurable_groups_updated_at();

-- 9. Función RPC para estadísticas de platos configurables
--    Cuenta cuántas veces se eligió cada opción por grupo
CREATE OR REPLACE FUNCTION get_configurable_plate_stats(
  p_category_id UUID,
  p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  group_name TEXT,
  option_name TEXT,
  total_count BIGINT,
  percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH selections AS (
    SELECT
      (elem->>'group_name')::TEXT AS g_name,
      (elem->>'selected')::TEXT AS s_name
    FROM lunch_orders lo,
         jsonb_array_elements(lo.configurable_selections) AS elem
    WHERE lo.category_id = p_category_id
      AND lo.order_date BETWEEN p_start_date AND p_end_date
      AND lo.is_cancelled = false
      AND jsonb_array_length(lo.configurable_selections) > 0
  ),
  counts AS (
    SELECT
      g_name,
      s_name,
      COUNT(*) AS cnt
    FROM selections
    GROUP BY g_name, s_name
  ),
  group_totals AS (
    SELECT g_name, SUM(cnt) AS total
    FROM counts
    GROUP BY g_name
  )
  SELECT
    c.g_name AS group_name,
    c.s_name AS option_name,
    c.cnt AS total_count,
    ROUND((c.cnt::NUMERIC / gt.total::NUMERIC) * 100, 1) AS percentage
  FROM counts c
  JOIN group_totals gt ON gt.g_name = c.g_name
  ORDER BY c.g_name, c.cnt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
