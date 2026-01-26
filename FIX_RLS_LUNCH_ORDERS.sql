-- PASO 1: Ver políticas actuales de lunch_orders
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'lunch_orders';

-- PASO 2: Eliminar políticas existentes si hay conflictos
DROP POLICY IF EXISTS "allow_parents_insert_lunch_orders" ON lunch_orders;
DROP POLICY IF EXISTS "allow_parents_view_lunch_orders" ON lunch_orders;
DROP POLICY IF EXISTS "allow_staff_manage_lunch_orders" ON lunch_orders;

-- PASO 3: Permitir a los PADRES insertar pedidos para SUS hijos
CREATE POLICY "allow_parents_insert_lunch_orders"
ON lunch_orders
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM students
    WHERE students.id = lunch_orders.student_id
    AND students.parent_id = auth.uid()
  )
);

-- PASO 4: Permitir a los PADRES ver y actualizar SUS pedidos
CREATE POLICY "allow_parents_manage_lunch_orders"
ON lunch_orders
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM students
    WHERE students.id = lunch_orders.student_id
    AND students.parent_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM students
    WHERE students.id = lunch_orders.student_id
    AND students.parent_id = auth.uid()
  )
);

-- PASO 5: Permitir a STAFF (admin/cajeros) ver TODOS los pedidos
CREATE POLICY "allow_staff_view_lunch_orders"
ON lunch_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'gestor_unidad', 'operador_caja')
  )
);

-- Verificar que se crearon correctamente
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'lunch_orders';
