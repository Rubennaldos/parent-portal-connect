-- =============================================
-- CORRECCIÓN: RLS POLICIES PARA COMBOS
-- =============================================

-- 1. Eliminar TODAS las políticas existentes
DROP POLICY IF EXISTS "admin_can_manage_combos" ON combos;
DROP POLICY IF EXISTS "admin_can_insert_combos" ON combos;
DROP POLICY IF EXISTS "admin_can_update_delete_combos" ON combos;
DROP POLICY IF EXISTS "admin_can_delete_combos" ON combos;

DROP POLICY IF EXISTS "admin_can_manage_combo_items" ON combo_items;
DROP POLICY IF EXISTS "admin_can_insert_combo_items" ON combo_items;
DROP POLICY IF EXISTS "admin_can_update_delete_combo_items" ON combo_items;
DROP POLICY IF EXISTS "admin_can_delete_combo_items" ON combo_items;

-- 2. Crear políticas separadas para INSERT con WITH CHECK
-- COMBOS: Permitir INSERT a admin_general y supervisor_red
CREATE POLICY "admin_can_insert_combos"
ON combos FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- COMBOS: Permitir UPDATE/DELETE a admin_general y supervisor_red
CREATE POLICY "admin_can_update_delete_combos"
ON combos FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

CREATE POLICY "admin_can_delete_combos"
ON combos FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- COMBO_ITEMS: Permitir INSERT
CREATE POLICY "admin_can_insert_combo_items"
ON combo_items FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- COMBO_ITEMS: Permitir UPDATE/DELETE
CREATE POLICY "admin_can_update_delete_combo_items"
ON combo_items FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

CREATE POLICY "admin_can_delete_combo_items"
ON combo_items FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red')
  )
);

-- 3. Verificación
SELECT 'Políticas RLS para combos corregidas correctamente' AS status;
