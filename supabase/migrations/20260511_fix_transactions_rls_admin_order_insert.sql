-- ============================================================================
-- FIX URGENTE RLS transactions:
-- - Permitir INSERT de transacciones cuando admin_sede/admin_general registran
--   pedidos de almuerzo para alumno/profesor.
-- - Evitar bloqueo por SELECT RESTRICTIVE en RETURNING del INSERT.
--
-- Contexto:
-- - El frontend inserta en public.transactions con .insert(...).select(...)
-- - Si RLS SELECT no permite ver la fila recién insertada, PostgREST devuelve
--   "new row violates row-level security policy for table transactions".
-- ============================================================================

-- 1) INSERT policy para staff administrativo (si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'transactions_insert_staff_by_role'
  ) THEN
    CREATE POLICY "transactions_insert_staff_by_role"
    ON public.transactions
    FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            -- Roles plataforma: alcance global
            p.role IN ('admin', 'admin_general', 'superadmin')
            OR
            -- Roles de sede: solo su sede
            (
              p.role IN ('admin_sede', 'gestor_unidad', 'operador_caja', 'cajero')
              AND p.school_id IS NOT NULL
              AND transactions.school_id IS NOT NULL
              AND transactions.school_id = p.school_id
            )
          )
      )
    );
  END IF;
END
$$;

-- 2) SELECT permissive para admins de sede (soporta RETURNING tras INSERT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'transactions_select_admin_sede_own_school'
  ) THEN
    CREATE POLICY "transactions_select_admin_sede_own_school"
    ON public.transactions
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin_sede'
          AND p.school_id IS NOT NULL
          AND transactions.school_id IS NOT NULL
          AND transactions.school_id = p.school_id
      )
    );
  END IF;
END
$$;

-- 3) Ajustar policy RESTRICTIVE para no depender solo del JWT y permitir admin_sede
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
      -- Compatibilidad con versión anterior (JWT)
      public.is_admin_general_jwt()
      OR
      -- Fallback robusto por profiles.role (evita depender de claims en JWT)
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'admin_general', 'superadmin')
      )
      OR
      -- Padres: ver filas de sus hijos (fix existente preservado)
      EXISTS (
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
      OR
      -- Roles de sede: solo su sede
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin_sede', 'gestor_unidad', 'operador_caja')
          AND p.school_id IS NOT NULL
          AND transactions.school_id IS NOT NULL
          AND transactions.school_id = p.school_id
      )
    );
  END IF;
END
$$;

-- 4) Verificación rápida
SELECT
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'transactions'
  AND policyname IN (
    'transactions_insert_staff_by_role',
    'transactions_select_admin_sede_own_school',
    'reports_select_admin_general_only'
  )
ORDER BY policyname, cmd;
