-- Permitir a admin_general y roles de staff insertar/actualizar/eliminar menús
CREATE POLICY "allow_staff_manage_lunch_menus"
ON lunch_menus
FOR ALL
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

-- Permitir a todos leer los menús (para que los padres y cajeros puedan verlos)
CREATE POLICY "allow_all_read_lunch_menus"
ON lunch_menus
FOR SELECT
TO authenticated
USING (true);
