-- ============================================
-- ARREGLO DEFINITIVO DE POLÍTICAS RLS
-- ============================================

-- 1. ELIMINAR TODAS LAS POLÍTICAS PROBLEMÁTICAS
DROP POLICY IF EXISTS "Staff can view all lunch orders from their school" ON public.lunch_orders;
DROP POLICY IF EXISTS "Admin General can view all lunch orders" ON public.lunch_orders;

-- 2. CREAR POLÍTICA CORRECTA PARA GESTOR DE UNIDAD
CREATE POLICY "Gestor can view lunch orders from their school"
ON public.lunch_orders
FOR SELECT
TO authenticated
USING (
  -- Verificar que el usuario es gestor_unidad Y que el pedido es de su sede
  EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'gestor_unidad'
    AND p.school_id = (
      SELECT school_id 
      FROM public.students 
      WHERE id = lunch_orders.student_id
    )
  )
);

-- 3. CREAR POLÍTICA CORRECTA PARA ADMIN GENERAL
CREATE POLICY "Admin General can view all lunch orders v2"
ON public.lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'admin_general'
  )
);

-- 4. CREAR POLÍTICA CORRECTA PARA CAJERO
CREATE POLICY "Cajero can view lunch orders from their school"
ON public.lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'cajero'
    AND p.school_id = (
      SELECT school_id 
      FROM public.students 
      WHERE id = lunch_orders.student_id
    )
  )
);

-- 5. VERIFICAR POLÍTICAS CREADAS
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'lunch_orders'
AND cmd = 'SELECT'
ORDER BY policyname;
