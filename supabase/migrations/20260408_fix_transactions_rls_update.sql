-- ================================================================
-- FIX RLS: Permitir UPDATE en transactions para gestor_unidad y operador_caja
-- Fecha: 2026-04-08
--
-- PROBLEMA: Las políticas antiguas usaban:
--   student_id IN (SELECT id FROM students WHERE school_id = ...)
--   Esto falla cuando student_id IS NULL (cliente genérico) → admin no podía editar esas ventas.
--
-- SOLUCIÓN: Usar transactions.school_id = profiles.school_id directamente.
--   Es más simple, más rápido y cubre TODAS las transacciones de la sede.
-- ================================================================

-- ── Eliminar políticas antiguas con USING incorrecto ────────────

DROP POLICY IF EXISTS "gestor_unidad_own_school_transactions"   ON transactions;
DROP POLICY IF EXISTS "operador_caja_own_school_transactions"   ON transactions;

-- ── Nuevas políticas usando school_id (no student_id) ──────────

-- Gestor de Unidad: todo sobre transacciones de SU sede
CREATE POLICY "gestor_unidad_own_school_transactions_v2"
ON transactions FOR ALL
TO authenticated
USING (
  (SELECT role       FROM profiles WHERE id = auth.uid()) = 'gestor_unidad'
  AND transactions.school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  (SELECT role       FROM profiles WHERE id = auth.uid()) = 'gestor_unidad'
  AND transactions.school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
);

-- Operador de Caja: todo sobre transacciones de SU sede
CREATE POLICY "operador_caja_own_school_transactions_v2"
ON transactions FOR ALL
TO authenticated
USING (
  (SELECT role       FROM profiles WHERE id = auth.uid()) = 'operador_caja'
  AND transactions.school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  (SELECT role       FROM profiles WHERE id = auth.uid()) = 'operador_caja'
  AND transactions.school_id = (SELECT school_id FROM profiles WHERE id = auth.uid())
);

-- ── Verificación ────────────────────────────────────────────────

SELECT
  policyname,
  cmd,
  CASE
    WHEN policyname LIKE '%gestor%'        THEN '✅ Gestor — usa school_id (corregido)'
    WHEN policyname LIKE '%operador_caja%' THEN '✅ Operador caja — usa school_id (corregido)'
    WHEN policyname LIKE '%admin_general%' THEN '👑 Admin general — ve todo'
    WHEN policyname LIKE '%superadmin%'    THEN '👑 Superadmin — ve todo'
    ELSE '— ' || policyname
  END AS descripcion
FROM pg_policies
WHERE tablename = 'transactions'
ORDER BY cmd, policyname;
