-- ============================================================================
-- FIX CRITICO: habilitar INSERT para padres en transactions + RETURNING seguro
-- Fecha: 2026-05-03
--
-- Objetivo:
-- 1) Agregar policy de INSERT para parent sin tocar datos.
-- 2) Si existe policy RESTRICTIVE de reportes en transactions, ajustarla
--    para no bloquear el RETURNING del insert de padres.
--
-- Restricciones:
-- - No DELETE/TRUNCATE/UPDATE de datos.
-- - No eliminación de políticas existentes.
-- ============================================================================

-- 1) INSERT para padres: solo sobre sus propios hijos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'Padres pueden insertar sus propias transacciones'
  ) THEN
    CREATE POLICY "Padres pueden insertar sus propias transacciones"
    ON public.transactions
    FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.students s
        WHERE s.id = transactions.student_id
          AND s.parent_id = auth.uid()
      )
    );
  END IF;
END
$$;

-- 2) RETURNING fix:
-- Si existe la policy restrictiva de reportes en transactions,
-- se ajusta para permitir SELECT de filas propias a padres.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'reports_select_admin_general_only'
      AND cmd = 'SELECT'
  ) THEN
    ALTER POLICY "reports_select_admin_general_only"
    ON public.transactions
    USING (
      public.is_admin_general_jwt()
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'parent'
          AND transactions.student_id IN (
            SELECT st.id
            FROM public.students st
            WHERE st.parent_id = auth.uid()
          )
      )
    );
  END IF;
END
$$;

-- 3) Verificación rápida de policies relevantes.
SELECT
  policyname,
  cmd,
  permissive,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'transactions'
  AND policyname IN (
    'Padres pueden insertar sus propias transacciones',
    'Padres pueden ver sus propias transacciones',
    'reports_select_admin_general_only'
  )
ORDER BY policyname, cmd;
