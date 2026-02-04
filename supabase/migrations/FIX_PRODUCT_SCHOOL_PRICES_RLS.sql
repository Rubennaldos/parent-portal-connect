-- =====================================================
-- CORREGIR POLÍTICAS RLS DE PRODUCT_SCHOOL_PRICES
-- =====================================================

-- 1. Ver las políticas actuales
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'product_school_prices';

-- 2. Eliminar políticas antiguas si existen (TODAS las variantes posibles)
DROP POLICY IF EXISTS "Usuarios autenticados pueden ver precios" ON product_school_prices;
DROP POLICY IF EXISTS "Usuarios autenticados pueden insertar precios" ON product_school_prices;
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar precios" ON product_school_prices;
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar precios" ON product_school_prices;
DROP POLICY IF EXISTS "Admin puede gestionar precios" ON product_school_prices;
DROP POLICY IF EXISTS "Usuarios autenticados pueden ver precios por sede" ON product_school_prices;
DROP POLICY IF EXISTS "Usuarios autenticados pueden insertar precios por sede" ON product_school_prices;
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar precios por sede" ON product_school_prices;
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar precios por sede" ON product_school_prices;

-- 3. Habilitar RLS en la tabla (si no está habilitado)
ALTER TABLE product_school_prices ENABLE ROW LEVEL SECURITY;

-- 4. POLÍTICA DE LECTURA (SELECT) - Todos los autenticados pueden ver
CREATE POLICY "Usuarios autenticados pueden ver precios por sede"
  ON product_school_prices
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. POLÍTICA DE INSERCIÓN (INSERT) - Solo usuarios autenticados
CREATE POLICY "Usuarios autenticados pueden insertar precios por sede"
  ON product_school_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 6. POLÍTICA DE ACTUALIZACIÓN (UPDATE) - Solo usuarios autenticados
CREATE POLICY "Usuarios autenticados pueden actualizar precios por sede"
  ON product_school_prices
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. POLÍTICA DE ELIMINACIÓN (DELETE) - Solo usuarios autenticados
CREATE POLICY "Usuarios autenticados pueden eliminar precios por sede"
  ON product_school_prices
  FOR DELETE
  TO authenticated
  USING (true);

-- 8. Verificar que se crearon correctamente
SELECT 
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE tablename = 'product_school_prices';
