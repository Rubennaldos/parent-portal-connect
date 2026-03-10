-- ============================================
-- FIX: RLS de lunch_orders usa school_id directo del pedido
-- El join con students fallaba cuando la relación no estaba disponible
-- ============================================

-- 1. Eliminar políticas existentes de SELECT para lunch_orders
DROP POLICY IF EXISTS "Admin general puede ver todos los pedidos de almuerzo" ON lunch_orders;
DROP POLICY IF EXISTS "Admin general puede ver todos los pedidos" ON lunch_orders;
DROP POLICY IF EXISTS "Gestor puede ver pedidos de su sede incluyendo manuales" ON lunch_orders;
DROP POLICY IF EXISTS "Gestor puede ver pedidos de su sede" ON lunch_orders;
DROP POLICY IF EXISTS "Padres pueden ver pedidos de sus hijos" ON lunch_orders;
DROP POLICY IF EXISTS "Profesores pueden ver sus propios pedidos" ON lunch_orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON lunch_orders;

-- 2. admin_general ve todos
CREATE POLICY "Admin general puede ver todos los pedidos de almuerzo"
ON lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
);

-- 3. gestor_unidad: usar school_id directo del pedido (más confiable que join)
CREATE POLICY "Gestor puede ver pedidos de su sede"
ON lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'gestor_unidad'
    AND (
      -- Usar school_id directo del pedido cuando está disponible
      lunch_orders.school_id = profiles.school_id
      OR
      -- Fallback: pedidos de estudiantes de su sede
      (lunch_orders.student_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM students
        WHERE students.id = lunch_orders.student_id
        AND students.school_id = profiles.school_id
      ))
      OR
      -- Fallback: pedidos de profesores de su sede
      (lunch_orders.teacher_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM teacher_profiles
        WHERE teacher_profiles.id = lunch_orders.teacher_id
        AND teacher_profiles.school_id_1 = profiles.school_id
      ))
    )
  )
);

-- 4. operador_caja ve pedidos de su sede
  CREATE POLICY "Operador caja puede ver pedidos de su sede"
  ON lunch_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'operador_caja'
      AND lunch_orders.school_id = profiles.school_id
    )
  );

-- 5. Padres ven pedidos de sus hijos
CREATE POLICY "Padres pueden ver pedidos de sus hijos"
ON lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'parent'
    AND lunch_orders.student_id IN (
      SELECT id FROM students
      WHERE parent_id = auth.uid()
    )
  )
);

-- 6. Profesores ven sus propios pedidos
CREATE POLICY "Profesores pueden ver sus propios pedidos"
ON lunch_orders
FOR SELECT
TO authenticated
USING (
  lunch_orders.teacher_id = auth.uid()
);
