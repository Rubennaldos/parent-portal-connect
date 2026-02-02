-- ============================================
-- ARREGLAR POLÍTICAS RLS DE LUNCH_ORDERS
-- ============================================

-- 1. Eliminar políticas existentes
DROP POLICY IF EXISTS "allow_parents_insert_lunch_orders" ON public.lunch_orders;
DROP POLICY IF EXISTS "allow_parents_manage_lunch_orders" ON public.lunch_orders;
DROP POLICY IF EXISTS "allow_staff_view_lunch_orders" ON public.lunch_orders;
DROP POLICY IF EXISTS "Teachers can create their own lunch orders" ON public.lunch_orders;
DROP POLICY IF EXISTS "Teachers can delete their own lunch orders" ON public.lunch_orders;
DROP POLICY IF EXISTS "Teachers can update their own lunch orders" ON public.lunch_orders;
DROP POLICY IF EXISTS "Teachers can view their own lunch orders" ON public.lunch_orders;

-- 2. Verificar si la tabla tiene RLS habilitado
ALTER TABLE public.lunch_orders ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLÍTICAS NUEVAS Y CORRECTAS
-- ============================================

-- PADRES: Pueden insertar pedidos de SUS hijos
DO $$ BEGIN
  CREATE POLICY "Parents can insert lunch orders for their children"
  ON public.lunch_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM public.students s
      WHERE s.id = lunch_orders.student_id 
      AND s.parent_id = auth.uid()
      AND s.is_active = true
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PADRES: Pueden ver pedidos de SUS hijos
DO $$ BEGIN
  CREATE POLICY "Parents can view lunch orders of their children"
  ON public.lunch_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM public.students s
      WHERE s.id = lunch_orders.student_id 
      AND s.parent_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PADRES: Pueden actualizar/cancelar pedidos de SUS hijos
DO $$ BEGIN
  CREATE POLICY "Parents can update lunch orders of their children"
  ON public.lunch_orders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM public.students s
      WHERE s.id = lunch_orders.student_id 
      AND s.parent_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PADRES: Pueden eliminar pedidos de SUS hijos
DO $$ BEGIN
  CREATE POLICY "Parents can delete lunch orders of their children"
  ON public.lunch_orders
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM public.students s
      WHERE s.id = lunch_orders.student_id 
      AND s.parent_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PROFESORES: Pueden crear sus propios pedidos
DO $$ BEGIN
  CREATE POLICY "Teachers can insert their own lunch orders"
  ON public.lunch_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM public.teacher_profiles tp
      WHERE tp.id = auth.uid()
    )
    AND student_id IS NULL -- Los profesores no tienen student_id
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PROFESORES: Pueden ver sus propios pedidos
DO $$ BEGIN
  CREATE POLICY "Teachers can view their own lunch orders"
  ON public.lunch_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM public.teacher_profiles tp
      WHERE tp.id = auth.uid()
    )
    AND student_id IS NULL
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- STAFF: Pueden ver TODOS los pedidos de su sede
DO $$ BEGIN
  CREATE POLICY "Staff can view all lunch orders from their school"
  ON public.lunch_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM public.profiles p
      JOIN public.students s ON lunch_orders.student_id = s.id
      WHERE p.id = auth.uid()
      AND p.role IN ('cajero', 'gestor_unidad', 'admin_general')
      AND (p.school_id = s.school_id OR p.role = 'admin_general')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- STAFF: Admin General puede ver TODO
DO $$ BEGIN
  CREATE POLICY "Admin General can view all lunch orders"
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- VERIFICAR RESULTADO
-- ============================================
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'lunch_orders'
ORDER BY cmd, policyname;
