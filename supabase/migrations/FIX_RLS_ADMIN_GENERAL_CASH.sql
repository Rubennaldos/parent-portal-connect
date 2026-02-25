-- ============================================================
-- 🔒 FIX: RLS Policies para admin_general en módulo de caja
-- ============================================================
-- PROBLEMA: El admin_general no puede ver cash_closures ni
-- cash_movements de todas las sedes porque las policies solo
-- permiten ver datos de la propia sede (school_id del perfil).
-- Como admin_general puede no tener school_id, no ve nada.
--
-- SOLUCIÓN: Agregar excepción para roles admin_general y super_admin
-- ============================================================

-- 1. Reemplazar policy de cash_closures SELECT
DROP POLICY IF EXISTS "Ver cierres de su sede" ON cash_closures;

CREATE POLICY "Ver cierres de su sede o todas si admin general"
ON cash_closures FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'super_admin')
  )
);

-- 2. Reemplazar policy de cash_closures INSERT (para cierre forzado)
DROP POLICY IF EXISTS "Crear cierres en su sede" ON cash_closures;

CREATE POLICY "Crear cierres en su sede o admin general"
ON cash_closures FOR INSERT
TO authenticated
WITH CHECK (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'super_admin')
  )
);

-- 3. Reemplazar policy de cash_movements SELECT
DROP POLICY IF EXISTS "Ver movimientos de su sede" ON cash_movements;

CREATE POLICY "Ver movimientos de su sede o todas si admin general"
ON cash_movements FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'super_admin')
  )
);

-- 4. Reemplazar policy de cash_register_config SELECT
DROP POLICY IF EXISTS "Ver config de su sede" ON cash_register_config;

CREATE POLICY "Ver config de su sede o todas si admin general"
ON cash_register_config FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'super_admin')
  )
);
