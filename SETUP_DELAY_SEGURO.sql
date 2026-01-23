-- ============================================================================
-- SISTEMA DE DELAY DE VISUALIZACIÓN DE COMPRAS (VERSIÓN SEGURA)
-- Puede ejecutarse múltiples veces sin errores
-- ============================================================================

-- PASO 1: Limpiar si ya existe
DROP INDEX IF EXISTS idx_purchase_visibility_school;
DROP FUNCTION IF EXISTS get_purchase_visibility_delay(UUID);
DROP FUNCTION IF EXISTS get_visibility_cutoff_date(UUID);
DROP TABLE IF EXISTS purchase_visibility_delay CASCADE;

-- PASO 2: Crear tabla de configuración
CREATE TABLE purchase_visibility_delay (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  delay_days INTEGER NOT NULL DEFAULT 2,
  applies_to TEXT NOT NULL DEFAULT 'purchases',
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(school_id)
);

-- Índice
CREATE INDEX idx_purchase_visibility_school ON purchase_visibility_delay(school_id);

-- PASO 3: RLS Policies
ALTER TABLE purchase_visibility_delay ENABLE ROW LEVEL SECURITY;

-- Admin General y SuperAdmin
DROP POLICY IF EXISTS "Admin General puede ver todas las configuraciones" ON purchase_visibility_delay;
CREATE POLICY "Admin General puede ver todas las configuraciones"
  ON purchase_visibility_delay FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "Admin General puede editar todas las configuraciones" ON purchase_visibility_delay;
CREATE POLICY "Admin General puede editar todas las configuraciones"
  ON purchase_visibility_delay FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'superadmin')
    )
  );

-- Gestor de Unidad
DROP POLICY IF EXISTS "Gestor de Unidad puede ver su configuración" ON purchase_visibility_delay;
CREATE POLICY "Gestor de Unidad puede ver su configuración"
  ON purchase_visibility_delay FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'gestor_unidad'
    )
  );

DROP POLICY IF EXISTS "Gestor de Unidad puede editar su configuración" ON purchase_visibility_delay;
CREATE POLICY "Gestor de Unidad puede editar su configuración"
  ON purchase_visibility_delay FOR ALL TO authenticated
  USING (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'gestor_unidad'
    )
  );

-- PASO 4: Función para obtener el delay
CREATE OR REPLACE FUNCTION get_purchase_visibility_delay(p_school_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_delay INTEGER;
BEGIN
  SELECT delay_days INTO v_delay
  FROM purchase_visibility_delay
  WHERE school_id = p_school_id;
  
  IF NOT FOUND THEN
    RETURN 2; -- Default 2 días
  END IF;
  
  RETURN v_delay;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PASO 5: Función para obtener fecha límite
CREATE OR REPLACE FUNCTION get_visibility_cutoff_date(p_school_id UUID)
RETURNS TIMESTAMP AS $$
DECLARE
  v_delay INTEGER;
  v_cutoff_date TIMESTAMP;
BEGIN
  v_delay := get_purchase_visibility_delay(p_school_id);
  v_cutoff_date := NOW() - (v_delay || ' days')::INTERVAL;
  RETURN v_cutoff_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PASO 6: Insertar configuraciones por defecto
INSERT INTO purchase_visibility_delay (school_id, delay_days, applies_to)
SELECT 
  id,
  2,
  'purchases'
FROM schools
WHERE is_active = true
ON CONFLICT (school_id) DO NOTHING;

-- PASO 7: Permisos
GRANT EXECUTE ON FUNCTION get_purchase_visibility_delay TO authenticated;
GRANT EXECUTE ON FUNCTION get_visibility_cutoff_date TO authenticated;

-- PASO 8: Verificar
SELECT '✅ Sistema de delay de visualización instalado correctamente' as status;

SELECT 
  s.name as sede,
  COALESCE(pvd.delay_days, 2) as dias_retraso,
  COALESCE(pvd.applies_to, 'purchases') as aplica_a,
  pvd.created_at as creado
FROM schools s
LEFT JOIN purchase_visibility_delay pvd ON pvd.school_id = s.id
WHERE s.is_active = true
ORDER BY s.name;
