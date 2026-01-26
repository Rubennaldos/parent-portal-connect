-- PASO 1: Ver todas las políticas actuales de lunch_menus
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'lunch_menus';

-- PASO 2: Eliminar TODAS las políticas existentes
DROP POLICY IF EXISTS "allow_staff_manage_lunch_menus" ON lunch_menus;
DROP POLICY IF EXISTS "allow_all_read_lunch_menus" ON lunch_menus;
DROP POLICY IF EXISTS "Users can view lunch menus" ON lunch_menus;
DROP POLICY IF EXISTS "Admin can manage lunch menus" ON lunch_menus;
DROP POLICY IF EXISTS "Staff can view lunch menus" ON lunch_menus;

-- PASO 3: Crear políticas correctas

-- Permitir INSERT a admin/staff
CREATE POLICY "allow_admin_insert_lunch_menus"
ON lunch_menus
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'gestor_unidad')
  )
);

-- Permitir UPDATE a admin/staff
CREATE POLICY "allow_admin_update_lunch_menus"
ON lunch_menus
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'gestor_unidad')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'gestor_unidad')
  )
);

-- Permitir DELETE a admin/staff
CREATE POLICY "allow_admin_delete_lunch_menus"
ON lunch_menus
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'superadmin', 'supervisor_red', 'gestor_unidad')
  )
);

-- Permitir SELECT a todos (para que padres y cajeros vean los menús)
CREATE POLICY "allow_authenticated_read_lunch_menus"
ON lunch_menus
FOR SELECT
TO authenticated
USING (true);
