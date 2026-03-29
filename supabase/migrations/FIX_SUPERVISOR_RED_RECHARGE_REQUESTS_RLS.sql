-- ============================================================
-- FIX: supervisor_red debe ver y aprobar vouchers de TODAS las sedes
-- 
-- PROBLEMA:
--   La política "rr_select_admin_sede" agrupa a supervisor_red
--   junto con gestor_unidad/cajero → solo ve su propia sede.
--   La política "rr_update_admin_only" lo restringe igual para UPDATE.
--
-- SOLUCIÓN:
--   1. Sacar supervisor_red de "rr_select_admin_sede"
--   2. Nueva política "rr_select_supervisor_red" → ve TODO (sin filtro de sede)
--   3. Actualizar "rr_update_admin_only" → supervisor_red puede aprobar en cualquier sede
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. SELECT: corregir quién ve qué
-- ────────────────────────────────────────────────────────────

-- Eliminar política actual de admins de sede (tiene a supervisor_red mal agrupado)
DROP POLICY IF EXISTS "rr_select_admin_sede" ON recharge_requests;

-- Recrear SIN supervisor_red (solo los que realmente son de sede)
CREATE POLICY "rr_select_admin_sede"
ON recharge_requests
FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid()
    AND role IN ('gestor_unidad', 'cajero', 'operador_caja', 'admin_sede')
  )
);

-- Nueva política: supervisor_red ve TODOS los vouchers (todas las sedes)
DROP POLICY IF EXISTS "rr_select_supervisor_red" ON recharge_requests;
CREATE POLICY "rr_select_supervisor_red"
ON recharge_requests
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'supervisor_red'
  )
);


-- ────────────────────────────────────────────────────────────
-- 2. UPDATE: supervisor_red puede aprobar/rechazar en cualquier sede
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "rr_update_admin_only" ON recharge_requests;

CREATE POLICY "rr_update_admin_only"
ON recharge_requests
FOR UPDATE
TO authenticated
USING (
  -- Admins de sede: solo su propia sede
  (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('gestor_unidad', 'cajero', 'operador_caja', 'admin_sede')
    )
  )
  OR
  -- admin_general, superadmin y supervisor_red: todas las sedes
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin', 'supervisor_red')
  )
)
WITH CHECK (
  -- Misma lógica para WITH CHECK
  (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('gestor_unidad', 'cajero', 'operador_caja', 'admin_sede')
    )
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin_general', 'superadmin', 'supervisor_red')
  )
);


-- ────────────────────────────────────────────────────────────
-- Verificar las políticas resultantes
-- ────────────────────────────────────────────────────────────
SELECT
  policyname,
  cmd,
  roles,
  qual
FROM pg_policies
WHERE tablename = 'recharge_requests'
ORDER BY cmd, policyname;

SELECT 'FIX aplicado: supervisor_red ahora ve y aprueba vouchers de todas las sedes' AS resultado;
