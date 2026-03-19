-- ============================================================
-- HOTFIX: infinite recursion en política RLS rr_update_admin_only
-- Problema: WITH CHECK hacía SELECT FROM recharge_requests → recursión
-- Solución: reemplazar WITH CHECK para que solo valide el rol del admin
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- 1. Eliminar la política con recursión
DROP POLICY IF EXISTS "rr_update_admin_only" ON recharge_requests;

-- 2. Recrear sin el subquery recursivo
CREATE POLICY "rr_update_admin_only"
ON recharge_requests
FOR UPDATE
TO authenticated
USING (
  (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('gestor_unidad','cajero','operador_caja','supervisor_red',
                   'admin_sede','admin_general','superadmin')
    )
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general','superadmin')
  )
)
WITH CHECK (
  (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('gestor_unidad','cajero','operador_caja','supervisor_red',
                   'admin_sede','admin_general','superadmin')
    )
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general','superadmin')
  )
);

-- 3. Verificar que ya no hay recursión
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'recharge_requests' AND cmd = 'UPDATE';

SELECT 'HOTFIX aplicado: rr_update_admin_only sin recursión' AS resultado;
