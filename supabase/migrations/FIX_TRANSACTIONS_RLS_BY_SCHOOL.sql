-- ============================================
-- Verificar y corregir políticas RLS de transactions (ventas)
-- ============================================

-- 1. Listar políticas actuales
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'transactions'
ORDER BY policyname;

-- 2. Eliminar políticas existentes de SELECT (incluye las que este script vuelve a crear)
DROP POLICY IF EXISTS "Admin general puede ver todas las transacciones" ON transactions;
DROP POLICY IF EXISTS "Gestor puede ver transacciones de su sede" ON transactions;
DROP POLICY IF EXISTS "Cajeros pueden ver transacciones de su sede" ON transactions;
DROP POLICY IF EXISTS "Padres pueden ver sus propias transacciones" ON transactions;
DROP POLICY IF EXISTS "Profesores pueden ver sus propias transacciones" ON transactions;
DROP POLICY IF EXISTS "Users can view their own transactions" ON transactions;
DROP POLICY IF EXISTS "Public can view transactions" ON transactions;

-- 3. Crear política para admin_general (ve TODO)
CREATE POLICY "Admin general puede ver todas las transacciones"
ON transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
);

-- 4. Crear política para gestor_unidad (solo SU sede)
CREATE POLICY "Gestor puede ver transacciones de su sede"
ON transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'gestor_unidad'
    AND transactions.school_id = profiles.school_id
  )
);

-- 5. Crear política para cajero (solo SU sede)
CREATE POLICY "Cajeros pueden ver transacciones de su sede"
ON transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'cajero'
    AND transactions.school_id = profiles.school_id
  )
);

-- 6. Crear política para padres (solo SUS transacciones)
CREATE POLICY "Padres pueden ver sus propias transacciones"
ON transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'parent'
    AND transactions.student_id IN (
      SELECT id FROM students
      WHERE parent_id = auth.uid()
    )
  )
);

-- 7. Crear política para profesores (solo SUS transacciones)
CREATE POLICY "Profesores pueden ver sus propias transacciones"
ON transactions
FOR SELECT
TO authenticated
USING (
  transactions.teacher_id = auth.uid()
);

-- ============================================
-- RESULTADO:
-- - admin_general: Ve TODAS las ventas
-- - gestor_unidad: Ve solo ventas de SU sede
-- - cajero: Ve solo ventas de SU sede
-- - parent: Ve solo sus propias transacciones
-- - teacher: Ve solo sus propias transacciones
-- ============================================
