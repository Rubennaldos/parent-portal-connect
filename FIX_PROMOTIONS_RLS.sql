-- =============================================
-- SOLUCIÓN: RLS PARA PROMOTIONS
-- =============================================

-- 1. ELIMINAR TODAS las políticas de promotions
DROP POLICY IF EXISTS "admin_can_view_promotions" ON promotions;
DROP POLICY IF EXISTS "admin_can_manage_promotions" ON promotions;
DROP POLICY IF EXISTS "promotions_select_policy" ON promotions;
DROP POLICY IF EXISTS "promotions_insert_policy" ON promotions;
DROP POLICY IF EXISTS "promotions_update_policy" ON promotions;
DROP POLICY IF EXISTS "promotions_delete_policy" ON promotions;

-- 2. CREAR políticas correctas para PROMOTIONS
CREATE POLICY "promotions_select_policy"
ON promotions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
  )
);

CREATE POLICY "promotions_insert_policy"
ON promotions FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
  )
);

CREATE POLICY "promotions_update_policy"
ON promotions FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
  )
);

CREATE POLICY "promotions_delete_policy"
ON promotions FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin_general', 'supervisor_red', 'gestor_unidad')
  )
);

-- 3. Verificar que todo está OK
SELECT 
  '✅ Políticas RLS para PROMOTIONS creadas correctamente' as "Status",
  COUNT(*) as "Total Políticas"
FROM pg_policies
WHERE tablename = 'promotions';

-- 4. Listar todas las políticas creadas
SELECT 
  tablename as "Tabla",
  policyname as "Política",
  cmd as "Comando"
FROM pg_policies
WHERE tablename = 'promotions'
ORDER BY cmd;
