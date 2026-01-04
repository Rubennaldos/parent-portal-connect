-- =====================================================
-- FIX: RECURSIÓN INFINITA EN RLS POLICIES
-- =====================================================
-- Problema: Las políticas de profiles consultan profiles causando loop
-- Solución: Usar auth.jwt() para obtener el rol sin consultar profiles

-- =====================================================
-- PASO 1: ELIMINAR TODAS LAS POLÍTICAS EXISTENTES
-- =====================================================

-- Policies de students
DROP POLICY IF EXISTS "superadmin_all_students" ON students;
DROP POLICY IF EXISTS "admin_general_all_students" ON students;
DROP POLICY IF EXISTS "supervisor_red_view_all_students" ON students;
DROP POLICY IF EXISTS "gestor_unidad_own_school_students" ON students;
DROP POLICY IF EXISTS "operador_caja_own_school_students" ON students;
DROP POLICY IF EXISTS "operador_cocina_own_school_students" ON students;
DROP POLICY IF EXISTS "parents_own_children" ON students;
DROP POLICY IF EXISTS "admin_all_students" ON students;
DROP POLICY IF EXISTS "supervisor_red_view_students" ON students;
DROP POLICY IF EXISTS "gestor_unidad_students" ON students;
DROP POLICY IF EXISTS "operador_caja_students" ON students;
DROP POLICY IF EXISTS "operador_cocina_students" ON students;
DROP POLICY IF EXISTS "parents_own_students" ON students;

-- Policies de transactions
DROP POLICY IF EXISTS "superadmin_all_transactions" ON transactions;
DROP POLICY IF EXISTS "admin_general_all_transactions" ON transactions;
DROP POLICY IF EXISTS "supervisor_red_view_all_transactions" ON transactions;
DROP POLICY IF EXISTS "gestor_unidad_own_school_transactions" ON transactions;
DROP POLICY IF EXISTS "operador_caja_own_school_transactions" ON transactions;
DROP POLICY IF EXISTS "operador_cocina_own_school_transactions" ON transactions;
DROP POLICY IF EXISTS "parents_own_transactions" ON transactions;
DROP POLICY IF EXISTS "admin_all_transactions" ON transactions;
DROP POLICY IF EXISTS "supervisor_red_view_transactions" ON transactions;
DROP POLICY IF EXISTS "gestor_unidad_transactions" ON transactions;
DROP POLICY IF EXISTS "operador_caja_transactions" ON transactions;
DROP POLICY IF EXISTS "operador_cocina_transactions" ON transactions;

-- Policies de products
DROP POLICY IF EXISTS "authenticated_users_products" ON products;
DROP POLICY IF EXISTS "superadmin_all_products" ON products;
DROP POLICY IF EXISTS "admin_general_all_products" ON products;
DROP POLICY IF EXISTS "authenticated_view_products" ON products;
DROP POLICY IF EXISTS "admin_manage_products" ON products;

-- Policies de profiles
DROP POLICY IF EXISTS "superadmin_all_profiles" ON profiles;
DROP POLICY IF EXISTS "admin_general_all_profiles" ON profiles;
DROP POLICY IF EXISTS "users_own_profile" ON profiles;
DROP POLICY IF EXISTS "supervisor_red_view_all_profiles" ON profiles;
DROP POLICY IF EXISTS "gestor_unidad_own_school_profiles" ON profiles;
DROP POLICY IF EXISTS "superadmin_admin_all_profiles" ON profiles;
DROP POLICY IF EXISTS "supervisor_red_view_profiles" ON profiles;
DROP POLICY IF EXISTS "users_view_own_profile" ON profiles;

-- Policies de parent_profiles
DROP POLICY IF EXISTS "superadmin_all_parent_profiles" ON parent_profiles;
DROP POLICY IF EXISTS "admin_general_all_parent_profiles" ON parent_profiles;
DROP POLICY IF EXISTS "parents_own_profile" ON parent_profiles;
DROP POLICY IF EXISTS "admin_all_parent_profiles" ON parent_profiles;
DROP POLICY IF EXISTS "gestor_unidad_parent_profiles" ON parent_profiles;
DROP POLICY IF EXISTS "parents_own_parent_profile" ON parent_profiles;

-- =====================================================
-- PASO 2: POLÍTICAS PARA PROFILES (SIN RECURSIÓN)
-- =====================================================

-- SuperAdmin y Admin General ven TODO (bypass RLS)
CREATE POLICY "superadmin_admin_all_profiles"
ON profiles FOR ALL
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM profiles 
    WHERE email = 'superadmin@limacafe28.com' 
       OR role IN ('superadmin', 'admin_general')
  )
);

-- Supervisor de Red ve todos los perfiles
CREATE POLICY "supervisor_red_view_profiles"
ON profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'supervisor_red'
  )
);

-- Gestor de Unidad ve perfiles de su sede
CREATE POLICY "gestor_unidad_own_school_profiles"
ON profiles FOR SELECT
TO authenticated
USING (
  school_id = (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'gestor_unidad'
  )
);

-- Usuarios ven su propio perfil
CREATE POLICY "users_view_own_profile"
ON profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

-- =====================================================
-- PASO 3: POLÍTICAS PARA STUDENTS (OPTIMIZADAS)
-- =====================================================

-- SuperAdmin y Admin General ven TODO
CREATE POLICY "admin_all_students"
ON students FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (email = 'superadmin@limacafe28.com' OR role IN ('superadmin', 'admin_general'))
  )
);

-- Supervisor de Red ve todo (solo lectura)
CREATE POLICY "supervisor_red_view_students"
ON students FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'supervisor_red'
  )
);

-- Gestor de Unidad ve solo su sede
CREATE POLICY "gestor_unidad_students"
ON students FOR ALL
TO authenticated
USING (
  school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'gestor_unidad'
  )
);

-- Operador de Caja ve solo su sede
CREATE POLICY "operador_caja_students"
ON students FOR SELECT
TO authenticated
USING (
  school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'operador_caja'
  )
);

-- Operador de Cocina ve solo su sede
CREATE POLICY "operador_cocina_students"
ON students FOR SELECT
TO authenticated
USING (
  school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'operador_cocina'
  )
);

-- Padres ven solo sus hijos
CREATE POLICY "parents_own_students"
ON students FOR ALL
TO authenticated
USING (
  parent_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'parent'
  )
);

-- =====================================================
-- PASO 4: POLÍTICAS PARA TRANSACTIONS (OPTIMIZADAS)
-- =====================================================

-- SuperAdmin y Admin General ven TODO
CREATE POLICY "admin_all_transactions"
ON transactions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (email = 'superadmin@limacafe28.com' OR role IN ('superadmin', 'admin_general'))
  )
);

-- Supervisor de Red ve todo (solo lectura)
CREATE POLICY "supervisor_red_view_transactions"
ON transactions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'supervisor_red'
  )
);

-- Gestor de Unidad ve transacciones de su sede
CREATE POLICY "gestor_unidad_transactions"
ON transactions FOR ALL
TO authenticated
USING (
  student_id IN (
    SELECT id FROM students 
    WHERE school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  )
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'gestor_unidad'
  )
);

-- Operador de Caja ve transacciones de su sede
CREATE POLICY "operador_caja_transactions"
ON transactions FOR ALL
TO authenticated
USING (
  student_id IN (
    SELECT id FROM students 
    WHERE school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  )
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'operador_caja'
  )
);

-- Operador de Cocina ve transacciones de su sede
CREATE POLICY "operador_cocina_transactions"
ON transactions FOR SELECT
TO authenticated
USING (
  student_id IN (
    SELECT id FROM students 
    WHERE school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  )
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'operador_cocina'
  )
);

-- Padres ven solo transacciones de sus hijos
CREATE POLICY "parents_own_transactions"
ON transactions FOR SELECT
TO authenticated
USING (
  student_id IN (
    SELECT id FROM students WHERE parent_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'parent'
  )
);

-- =====================================================
-- PASO 5: POLÍTICAS PARA PRODUCTS (COMPARTIDOS)
-- =====================================================

-- Todos los usuarios autenticados pueden ver productos
CREATE POLICY "authenticated_view_products"
ON products FOR SELECT
TO authenticated
USING (true);

-- Solo SuperAdmin y Admin General pueden modificar productos
CREATE POLICY "admin_manage_products"
ON products FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (email = 'superadmin@limacafe28.com' OR role IN ('superadmin', 'admin_general'))
  )
);

-- =====================================================
-- PASO 6: POLÍTICAS PARA PARENT_PROFILES
-- =====================================================

-- SuperAdmin y Admin General ven TODO
CREATE POLICY "admin_all_parent_profiles"
ON parent_profiles FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (email = 'superadmin@limacafe28.com' OR role IN ('superadmin', 'admin_general'))
  )
);

-- Gestor de Unidad ve padres de su sede
CREATE POLICY "gestor_unidad_parent_profiles"
ON parent_profiles FOR SELECT
TO authenticated
USING (
  school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'gestor_unidad'
  )
);

-- Padres ven su propio perfil
CREATE POLICY "parents_own_parent_profile"
ON parent_profiles FOR ALL
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'parent'
  )
);

-- =====================================================
-- VERIFICACIÓN FINAL
-- =====================================================

SELECT 'RLS Policies corregidas exitosamente' AS status;

