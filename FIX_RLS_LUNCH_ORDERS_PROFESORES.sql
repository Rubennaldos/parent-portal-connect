-- Corregir políticas RLS para lunch_orders
-- Permitir que gestores vean pedidos de PROFESORES de su sede

-- 1. Eliminar política antigua si existe
DROP POLICY IF EXISTS "Staff can view all lunch orders from their school" ON public.lunch_orders;
DROP POLICY IF EXISTS "Gestores pueden ver pedidos de su sede" ON public.lunch_orders;

-- 2. Crear política mejorada que incluya PROFESORES
CREATE POLICY "Gestores pueden ver pedidos de alumnos y profesores de su sede"
ON public.lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('gestor_unidad', 'admin_general')
    AND (
      -- Admin general ve todo
      p.role = 'admin_general'
      OR
      -- Gestor ve pedidos de alumnos de su sede
      EXISTS (
        SELECT 1 FROM students s
        WHERE s.id = lunch_orders.student_id
        AND s.school_id = p.school_id
      )
      OR
      -- ✅ NUEVO: Gestor ve pedidos de profesores de su sede
      EXISTS (
        SELECT 1 FROM teacher_profiles t
        WHERE t.id = lunch_orders.teacher_id
        AND t.school_id_1 = p.school_id
      )
    )
  )
);

-- 3. Política para INSERT (padres y profesores)
DROP POLICY IF EXISTS "Parents can insert lunch orders for their children" ON public.lunch_orders;
DROP POLICY IF EXISTS "Padres y profesores pueden crear pedidos" ON public.lunch_orders;

CREATE POLICY "Padres y profesores pueden crear pedidos"
ON public.lunch_orders
FOR INSERT
TO authenticated
WITH CHECK (
  -- Padres pueden crear pedidos para sus hijos
  (
    student_id IS NOT NULL 
    AND teacher_id IS NULL
    AND EXISTS (
      SELECT 1 FROM students s
      INNER JOIN parent_profiles pp ON s.parent_id = pp.id
      WHERE s.id = student_id
      AND pp.id = auth.uid()
    )
  )
  OR
  -- Profesores pueden crear pedidos para sí mismos
  (
    teacher_id IS NOT NULL
    AND student_id IS NULL
    AND teacher_id = auth.uid()
  )
  OR
  -- Staff puede crear pedidos (entregas sin pedido)
  (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('gestor_unidad', 'admin_general', 'cajero')
    )
  )
);

-- 4. Política para UPDATE (solo staff)
DROP POLICY IF EXISTS "Staff can update lunch orders" ON public.lunch_orders;
DROP POLICY IF EXISTS "Personal puede actualizar pedidos" ON public.lunch_orders;

CREATE POLICY "Personal puede actualizar pedidos de su sede"
ON public.lunch_orders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('gestor_unidad', 'admin_general', 'cajero')
    AND (
      p.role = 'admin_general'
      OR
      EXISTS (
        SELECT 1 FROM students s
        WHERE s.id = lunch_orders.student_id
        AND s.school_id = p.school_id
      )
      OR
      EXISTS (
        SELECT 1 FROM teacher_profiles t
        WHERE t.id = lunch_orders.teacher_id
        AND t.school_id_1 = p.school_id
      )
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('gestor_unidad', 'admin_general', 'cajero')
  )
);

-- 5. Verificar que las políticas se crearon correctamente
SELECT policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'lunch_orders'
ORDER BY policyname;
