-- ============================================================================
-- FIX TRANSACTIONS RLS — ACCESO COMPLETO DEL ROL teacher
-- Fecha: 2026-05-11
--
-- PROBLEMA RAÍZ (dos vectores independientes):
--
-- 1) SELECT bloqueado por política RESTRICTIVA:
--    La policy "reports_select_admin_general_only" es AS RESTRICTIVE en
--    public.transactions. En PostgreSQL, para que una fila sea visible el
--    usuario debe cumplir AL MENOS UNA policy permisiva Y TODAS las
--    restrictivas. La restrictiva nunca incluyó la rama teacher_id = auth.uid(),
--    por lo que TODOS los profesores ven 0 filas sin importar cuántas políticas
--    permisivas existan para ellos.
--
-- 2) INSERT bloqueado: no existe ninguna policy de INSERT para el rol teacher.
--    Cuando el profesor pide almuerzo desde TeacherLunchCalendar.tsx o
--    UnifiedLunchCalendarV2.tsx, el INSERT en transactions queda bloqueado
--    silenciosamente (o con error), dejando filas huérfanas en lunch_orders
--    sin deuda correspondiente.
--
-- SOLUCIÓN:
--    A) Extender la restrictiva para que un profesor pase cuando la fila le
--       pertenece (teacher_id = auth.uid()). Conserva íntegras todas las
--       ramas anteriores (admin JWT, admin por profiles.role, padres, sede).
--    B) Crear policy permisiva de INSERT para profesores sobre sus propias
--       filas (teacher_id = auth.uid()).
--
-- GARANTÍAS DE SEGURIDAD:
--    - Un profesor SOLO ve filas donde transactions.teacher_id = auth.uid().
--    - Un profesor SOLO puede insertar filas donde teacher_id = auth.uid().
--    - No se tocan triggers, funciones de saldo, ni ninguna lógica de cobro.
--    - No se toca Izipay, pasarela, webhooks ni Edge Functions.
--    - No se modifica la lógica de fn_sync_student_balance.
--    - Todos los bloques son idempotentes (IF EXISTS / IF NOT EXISTS).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE A — Extender la policy RESTRICTIVA para permitir al profesor ver
--            sus propias transacciones.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'transactions'
      AND policyname = 'reports_select_admin_general_only'
      AND cmd        = 'SELECT'
  ) THEN

    ALTER POLICY "reports_select_admin_general_only"
    ON public.transactions
    USING (
      -- ① Admins globales: por JWT (compatibilidad con claims)
      public.is_admin_general_jwt()

      OR

      -- ② Admins globales: por profiles.role (robusto cuando el JWT no trae claims)
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id   = auth.uid()
          AND p.role IN ('admin', 'admin_general', 'superadmin')
      )

      OR

      -- ③ Padres: solo filas de sus propios hijos
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id   = auth.uid()
          AND p.role = 'parent'
          AND transactions.student_id IN (
            SELECT st.id
            FROM public.students st
            WHERE st.parent_id = auth.uid()
          )
      )

      OR

      -- ④ Roles de sede: admin_sede, gestor_unidad, operador_caja
      --    Solo filas de su propia sede.
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id        = auth.uid()
          AND p.role      IN ('admin_sede', 'gestor_unidad', 'operador_caja', 'cajero')
          AND p.school_id IS NOT NULL
          AND transactions.school_id IS NOT NULL
          AND transactions.school_id = p.school_id
      )

      OR

      -- ⑤ Profesores: solo sus propias filas.
      --    Condición directa en la fila: no requiere subquery a profiles.
      transactions.teacher_id = auth.uid()
    );

    RAISE NOTICE '[20260511-teacher-rls] RESTRICTIVA extendida: branch teacher_id = auth.uid() añadida.';

  ELSE
    RAISE WARNING '[20260511-teacher-rls] Policy reports_select_admin_general_only NO EXISTE en transactions. Verificar que 20260503_reports_rls_admin_general_only.sql fue aplicada.';
  END IF;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE B — Policy permisiva de SELECT para profesores (debe existir; si no
--            existe la crea; si ya existe no falla).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'transactions'
      AND policyname = 'Profesores pueden ver sus propias transacciones'
      AND cmd        = 'SELECT'
  ) THEN
    CREATE POLICY "Profesores pueden ver sus propias transacciones"
    ON public.transactions
    FOR SELECT
    TO authenticated
    USING (
      transactions.teacher_id = auth.uid()
    );

    RAISE NOTICE '[20260511-teacher-rls] PERMISIVA SELECT para profesores creada.';
  ELSE
    RAISE NOTICE '[20260511-teacher-rls] PERMISIVA SELECT para profesores ya existe. Sin cambios.';
  END IF;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE C — Policy de INSERT para profesores.
--            Sin esta policy, el INSERT que hacen TeacherLunchCalendar.tsx y
--            UnifiedLunchCalendarV2.tsx queda bloqueado en producción.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'transactions'
      AND policyname = 'Profesores pueden insertar sus propias transacciones'
      AND cmd        = 'INSERT'
  ) THEN
    CREATE POLICY "Profesores pueden insertar sus propias transacciones"
    ON public.transactions
    FOR INSERT
    TO authenticated
    WITH CHECK (
      -- El profesor solo puede insertar filas donde ÉL es el teacher_id.
      -- Ningún profesor puede insertar una transacción a nombre de otro.
      transactions.teacher_id = auth.uid()
    );

    RAISE NOTICE '[20260511-teacher-rls] PERMISIVA INSERT para profesores creada.';
  ELSE
    RAISE NOTICE '[20260511-teacher-rls] PERMISIVA INSERT para profesores ya existe. Sin cambios.';
  END IF;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO FINAL — Verificar el estado real de las policies en transactions
-- después de aplicar esta migración.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  policyname                                  AS politica,
  cmd                                         AS operacion,
  CASE permissive WHEN 'PERMISSIVE' THEN 'PERMISIVA' ELSE 'RESTRICTIVA ⚠️' END AS tipo,
  roles,
  qual                                        AS condicion_using
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'transactions'
ORDER BY
  CASE permissive WHEN 'RESTRICTIVE' THEN 0 ELSE 1 END,
  cmd,
  policyname;
