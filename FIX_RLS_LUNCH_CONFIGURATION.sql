-- ============================================
-- ARREGLAR RLS DE LUNCH_CONFIGURATION
-- ============================================

-- 1. Habilitar RLS si no está habilitado
ALTER TABLE public.lunch_configuration ENABLE ROW LEVEL SECURITY;

-- 2. ELIMINAR políticas existentes (si hay)
DROP POLICY IF EXISTS "Admin General can manage lunch configuration" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Gestor can manage lunch configuration for their school" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Allow authenticated users to view lunch configuration" ON public.lunch_configuration;
DROP POLICY IF EXISTS "Allow staff to manage lunch configuration" ON public.lunch_configuration;

-- 3. CREAR POLÍTICAS CORRECTAS

-- SELECT: Todos los autenticados pueden ver la configuración
CREATE POLICY "Anyone authenticated can view lunch configuration"
ON public.lunch_configuration
FOR SELECT
TO authenticated
USING (true);

-- INSERT: Solo admin_general y gestor_unidad pueden crear configuraciones
CREATE POLICY "Staff can insert lunch configuration"
ON public.lunch_configuration
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('admin_general', 'gestor_unidad')
  )
);

-- UPDATE: Admin General puede actualizar TODO
CREATE POLICY "Admin General can update all lunch configuration"
ON public.lunch_configuration
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'admin_general'
  )
);

-- UPDATE: Gestor de Unidad puede actualizar la configuración de SU sede
CREATE POLICY "Gestor can update lunch configuration for their school"
ON public.lunch_configuration
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'gestor_unidad'
    AND p.school_id = lunch_configuration.school_id
  )
);

-- DELETE: Solo Admin General puede eliminar
CREATE POLICY "Admin General can delete lunch configuration"
ON public.lunch_configuration
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'admin_general'
  )
);

-- 4. VERIFICAR POLÍTICAS CREADAS
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'lunch_configuration'
ORDER BY cmd, policyname;
