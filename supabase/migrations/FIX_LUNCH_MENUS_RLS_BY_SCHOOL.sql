-- ============================================
-- FIX: Políticas RLS de lunch_menus para filtrar por sede
-- ============================================

-- 1. Eliminar políticas existentes de SELECT
DROP POLICY IF EXISTS "Admin general puede ver todos los menus" ON lunch_menus;
DROP POLICY IF EXISTS "Gestor puede ver menus de su sede" ON lunch_menus;
DROP POLICY IF EXISTS "Gestor unidad can view menus from their school" ON lunch_menus;
DROP POLICY IF EXISTS "Public can view active menus" ON lunch_menus;
DROP POLICY IF EXISTS "Users can view menus" ON lunch_menus;

-- 2. Crear política para admin_general (ve todo)
CREATE POLICY "Admin general puede ver todos los menus de almuerzo"
ON lunch_menus
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
);

-- 3. Crear política para gestor_unidad (solo su sede)
CREATE POLICY "Gestor puede ver menus de su sede usando school_id"
ON lunch_menus
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'gestor_unidad'
    AND lunch_menus.school_id = profiles.school_id
  )
);

-- 4. Crear política para padres (menus de la sede de sus hijos)
CREATE POLICY "Padres pueden ver menus de la sede de sus hijos"
ON lunch_menus
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'parent'
    AND lunch_menus.school_id IN (
      SELECT school_id FROM students
      WHERE parent_id = auth.uid()
    )
  )
);

-- 5. Crear política para profesores (menus de su sede)
CREATE POLICY "Profesores pueden ver menus de su sede"
ON lunch_menus
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM teacher_profiles
    WHERE teacher_profiles.id = auth.uid()
    AND lunch_menus.school_id = teacher_profiles.school_id_1
  )
);

-- ============================================
-- RESULTADO:
-- - admin_general: Ve TODOS los menús
-- - gestor_unidad: Ve SOLO menús de SU sede
-- - parent: Ve menús de la sede de sus hijos
-- - teacher: Ve menús de su sede
-- ============================================
