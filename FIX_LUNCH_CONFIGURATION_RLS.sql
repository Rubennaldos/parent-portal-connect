-- ============================================
-- ARREGLAR POLÍTICAS RLS DE LUNCH_CONFIGURATION
-- ============================================

-- 1. Eliminar políticas antiguas
DROP POLICY IF EXISTS "Users can view lunch configuration" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Admins can manage lunch configuration" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Admin can insert lunch configuration" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Admin can update lunch configuration" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Admin can delete lunch configuration" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Enable insert for admins" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Enable update for admins" ON public.lunch_configuration;

-- 2. Asegurarse de que RLS esté habilitado
ALTER TABLE public.lunch_configuration ENABLE ROW LEVEL SECURITY;

-- 3. Crear políticas SIMPLES Y FUNCIONALES
-- Política de LECTURA: Todos los usuarios autenticados pueden leer
CREATE POLICY "Anyone authenticated can view lunch config"
  ON public.lunch_configuration
  FOR SELECT
  TO authenticated
  USING (true);

-- Política de INSERT: Admin General puede insertar
CREATE POLICY "Admin can insert lunch config"
  ON public.lunch_configuration
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_general'
    )
  );

-- Política de UPDATE: Admin General puede actualizar
CREATE POLICY "Admin can update lunch config"
  ON public.lunch_configuration
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_general'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_general'
    )
  );

-- Política de DELETE: Admin General puede eliminar
CREATE POLICY "Admin can delete lunch config"
  ON public.lunch_configuration
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_general'
    )
  );

-- ============================================
-- VERIFICACIÓN
-- ============================================

-- Ver todas las políticas de lunch_configuration
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
WHERE tablename = 'lunch_configuration';

-- Probar SELECT
SELECT * FROM public.lunch_configuration LIMIT 1;
