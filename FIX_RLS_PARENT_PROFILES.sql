-- ============================================
-- FIX: POLÍTICAS RLS PARA PARENT_PROFILES
-- Permitir acceso a admin_general y otros roles
-- ============================================

-- 1. Eliminar políticas existentes
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON parent_profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON parent_profiles;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON parent_profiles;
DROP POLICY IF EXISTS "Allow parents to view own profile" ON parent_profiles;
DROP POLICY IF EXISTS "Allow admins to view all parent profiles" ON parent_profiles;
DROP POLICY IF EXISTS "Allow admins to manage parent profiles" ON parent_profiles;

-- 2. Crear políticas nuevas y correctas

-- Admin General puede ver todos los padres
CREATE POLICY "Admin General can view all parent profiles"
ON parent_profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
);

-- School Admin puede ver padres de su sede
CREATE POLICY "School Admin can view parent profiles of their school"
ON parent_profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('school_admin', 'gestor_unidad')
    AND profiles.school_id = parent_profiles.school_id
  )
);

-- Padres pueden ver su propio perfil
CREATE POLICY "Parents can view own profile"
ON parent_profiles FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
);

-- Admin General puede insertar padres
CREATE POLICY "Admin General can insert parent profiles"
ON parent_profiles FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
);

-- School Admin puede insertar padres en su sede
CREATE POLICY "School Admin can insert parent profiles"
ON parent_profiles FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('school_admin', 'gestor_unidad')
    AND profiles.school_id = parent_profiles.school_id
  )
);

-- Admin General puede actualizar cualquier padre
CREATE POLICY "Admin General can update parent profiles"
ON parent_profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin_general'
  )
);

-- School Admin puede actualizar padres de su sede
CREATE POLICY "School Admin can update parent profiles"
ON parent_profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('school_admin', 'gestor_unidad')
    AND profiles.school_id = parent_profiles.school_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('school_admin', 'gestor_unidad')
    AND profiles.school_id = parent_profiles.school_id
  )
);

-- Padres pueden actualizar su propio perfil
CREATE POLICY "Parents can update own profile"
ON parent_profiles FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 3. Verificar que RLS esté habilitado
ALTER TABLE parent_profiles ENABLE ROW LEVEL SECURITY;

-- 4. Verificar políticas creadas
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'parent_profiles'
ORDER BY policyname;

-- 5. Probar consulta como admin_general
SELECT 
  pp.id,
  pp.full_name,
  pp.dni,
  pp.phone_1,
  pp.school_id,
  s.name as school_name
FROM parent_profiles pp
LEFT JOIN schools s ON s.id = pp.school_id
ORDER BY pp.full_name;

-- ✅ Políticas RLS actualizadas correctamente
-- ✅ Ahora recarga el módulo de Config Padres (F5)
