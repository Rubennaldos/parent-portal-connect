-- ============================================================================
-- RLS: permitir SELECT a gestor_unidad (y operador_caja) bajo policy RESTRICTIVE
-- Fecha: 2026-05-04
--
-- Contexto:
-- - 20260503_reports_rls_admin_general_only.sql creó
--   "reports_select_admin_general_only" AS RESTRICTIVE FOR SELECT en
--   public.transactions (y otras tablas).
-- - En PostgreSQL, además de al menos una policy PERMISSIVE, TODAS las
--   RESTRICTIVE deben evaluar true para que la fila sea visible.
-- - gestor_unidad ya cumple gestor_unidad_own_school_transactions_v2 (PERMISSIVE),
--   pero quedaba bloqueado porque la RESTRICTIVE solo permitía admin (JWT/perfil)
--   o el bypass de padres del fix 20260503_fix_transactions_parent_insert_returning.
--
-- Solución:
-- - Extender el USING de la policy restrictiva en transactions para que
--   gestor_unidad y operador_caja pasen cuando
--   transactions.school_id = profiles.school_id
--   (misma regla de aislamiento que las policies v2 por sede).
--
-- Diagnóstico manual (SQL Editor, rol service_role o postgres):
--   SELECT count(*) FROM transactions
--   WHERE school_id = (SELECT school_id FROM profiles WHERE email = 'matiasmc1@limacafe28.com');
-- Si count > 0 pero la app (como gestor) ve 0 filas, confirma bloqueo RLS.
-- ============================================================================

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
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('gestor_unidad', 'operador_caja')
          AND p.school_id IS NOT NULL
          AND transactions.school_id IS NOT NULL
          AND transactions.school_id = p.school_id
      )
    );
  ELSE
    RAISE NOTICE '[20260504] Policy reports_select_admin_general_only no existe en transactions; no se altera.';
  END IF;
END
$$;
