-- ============================================
-- LIMPIAR TODO ANTES DE RECREAR
-- ============================================
-- Eliminamos todo lo anterior para empezar limpio

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "authenticated_view_categories" ON lunch_categories;
DROP POLICY IF EXISTS "admin_gestor_insert_categories" ON lunch_categories;
DROP POLICY IF EXISTS "admin_gestor_update_categories" ON lunch_categories;
DROP POLICY IF EXISTS "admin_gestor_delete_categories" ON lunch_categories;

-- Eliminar trigger
DROP TRIGGER IF EXISTS lunch_categories_updated_at ON lunch_categories;
DROP FUNCTION IF EXISTS update_lunch_categories_updated_at();

-- Eliminar índices
DROP INDEX IF EXISTS idx_lunch_categories_school;
DROP INDEX IF EXISTS idx_lunch_categories_target;
DROP INDEX IF EXISTS idx_lunch_categories_active;
DROP INDEX IF EXISTS idx_lunch_menus_category;
DROP INDEX IF EXISTS idx_lunch_menus_target;

-- Eliminar tabla (esto también eliminará las categorías creadas, las volveremos a crear)
DROP TABLE IF EXISTS lunch_categories CASCADE;

-- ============================================
-- RECREAR TODO DESDE CERO
-- ============================================

-- Crear tabla de categorías de almuerzos
CREATE TABLE lunch_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('students', 'teachers', 'both')),
  color VARCHAR(7) DEFAULT '#3B82F6',
  icon VARCHAR(50) DEFAULT 'utensils',
  price DECIMAL(10, 2),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_lunch_categories_school ON lunch_categories(school_id);
CREATE INDEX idx_lunch_categories_target ON lunch_categories(target_type);
CREATE INDEX idx_lunch_categories_active ON lunch_categories(is_active);

-- Modificar tabla lunch_menus para agregar category_id (si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'lunch_menus' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE lunch_menus ADD COLUMN category_id UUID REFERENCES lunch_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lunch_menus_category ON lunch_menus(category_id);

-- Agregar target_type a lunch_menus (si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'lunch_menus' AND column_name = 'target_type'
  ) THEN
    ALTER TABLE lunch_menus ADD COLUMN target_type VARCHAR(20) DEFAULT 'students' CHECK (target_type IN ('students', 'teachers', 'both'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lunch_menus_target ON lunch_menus(target_type);

-- Insertar categorías por defecto para cada escuela
INSERT INTO lunch_categories (school_id, name, description, target_type, color, icon, display_order)
SELECT 
  id as school_id,
  'Almuerzo Clásico',
  'Menú tradicional completo con entrada, segundo, bebida y postre',
  'students',
  '#3B82F6',
  'utensils',
  1
FROM schools;

INSERT INTO lunch_categories (school_id, name, description, target_type, color, icon, display_order)
SELECT 
  id as school_id,
  'Almuerzo Light',
  'Opción saludable y ligera, ideal para cuidar la alimentación',
  'students',
  '#10B981',
  'salad',
  2
FROM schools;

INSERT INTO lunch_categories (school_id, name, description, target_type, color, icon, display_order)
SELECT 
  id as school_id,
  'Almuerzo Económico',
  'Menú accesible sin comprometer la calidad nutricional',
  'students',
  '#F59E0B',
  'coins',
  3
FROM schools;

INSERT INTO lunch_categories (school_id, name, description, target_type, color, icon, display_order)
SELECT 
  id as school_id,
  'Almuerzo para Profesores',
  'Menú especial diseñado para el personal docente',
  'teachers',
  '#8B5CF6',
  'briefcase',
  4
FROM schools;

INSERT INTO lunch_categories (school_id, name, description, target_type, color, icon, display_order)
SELECT 
  id as school_id,
  'Almuerzo Vegetariano',
  'Opciones 100% vegetarianas, sin carnes ni pescados',
  'both',
  '#059669',
  'leaf',
  5
FROM schools;

-- RLS Policies
ALTER TABLE lunch_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_view_categories" ON lunch_categories
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'super_admin')
      )
      OR
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.school_id = lunch_categories.school_id
      )
    )
  );

CREATE POLICY "admin_gestor_insert_categories" ON lunch_categories
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'super_admin')
      )
      OR
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role = 'gestor_unidad'
        AND p.school_id = lunch_categories.school_id
      )
    )
  );

CREATE POLICY "admin_gestor_update_categories" ON lunch_categories
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'super_admin')
      )
      OR
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role = 'gestor_unidad'
        AND p.school_id = lunch_categories.school_id
      )
    )
  );

CREATE POLICY "admin_gestor_delete_categories" ON lunch_categories
  FOR DELETE
  USING (
    auth.uid() IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('admin_general', 'super_admin')
      )
      OR
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role = 'gestor_unidad'
        AND p.school_id = lunch_categories.school_id
      )
    )
  );

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_lunch_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lunch_categories_updated_at
  BEFORE UPDATE ON lunch_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_lunch_categories_updated_at();

-- Comentarios
COMMENT ON TABLE lunch_categories IS 'Categorías de almuerzos personalizables por escuela (Ej: Clásico, Light, Económico, Vegetariano)';
COMMENT ON COLUMN lunch_categories.target_type IS 'Para quién es el almuerzo: students (alumnos), teachers (profesores), o both (ambos)';
COMMENT ON COLUMN lunch_categories.color IS 'Color hexadecimal para identificar visualmente la categoría en la UI';
COMMENT ON COLUMN lunch_categories.icon IS 'Nombre del icono de lucide-react para mostrar en la UI';
COMMENT ON COLUMN lunch_categories.display_order IS 'Orden de visualización en la interfaz (menor número = primero)';

SELECT '✅ Sistema de categorías de almuerzos creado exitosamente' as resultado;
