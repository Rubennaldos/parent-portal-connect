-- =============================================
-- FIX: Row Level Security para student_relationships
-- =============================================

-- PASO 1: Deshabilitar RLS temporalmente
ALTER TABLE student_relationships DISABLE ROW LEVEL SECURITY;

-- PASO 2: Eliminar TODAS las políticas existentes
DROP POLICY IF EXISTS "Parents can view their own student relationships" ON student_relationships;
DROP POLICY IF EXISTS "Parents can manage their own student relationships" ON student_relationships;
DROP POLICY IF EXISTS "Staff can view all relationships" ON student_relationships;
DROP POLICY IF EXISTS "Staff can manage all relationships" ON student_relationships;
DROP POLICY IF EXISTS "authenticated_users_student_relationships" ON student_relationships;
DROP POLICY IF EXISTS "allow_authenticated_select_student_relationships" ON student_relationships;
DROP POLICY IF EXISTS "allow_authenticated_insert_student_relationships" ON student_relationships;
DROP POLICY IF EXISTS "allow_authenticated_update_student_relationships" ON student_relationships;
DROP POLICY IF EXISTS "allow_authenticated_delete_student_relationships" ON student_relationships;

-- PASO 3: Crear políticas nuevas y permisivas

-- Política para SELECT
CREATE POLICY "allow_authenticated_select_student_relationships"
ON student_relationships
FOR SELECT
TO authenticated
USING (true);

-- Política para INSERT
CREATE POLICY "allow_authenticated_insert_student_relationships"
ON student_relationships
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política para UPDATE
CREATE POLICY "allow_authenticated_update_student_relationships"
ON student_relationships
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Política para DELETE
CREATE POLICY "allow_authenticated_delete_student_relationships"
ON student_relationships
FOR DELETE
TO authenticated
USING (true);

-- PASO 4: Reactivar RLS
ALTER TABLE student_relationships ENABLE ROW LEVEL SECURITY;

-- PASO 5: Verificar políticas
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'student_relationships'
ORDER BY policyname;
