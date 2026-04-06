-- Agrega la columna school_id a in_app_notifications si no existe
-- Regla: user_id NULL + school_id = global para esa sede
--        user_id NULL + school_id NULL = global para todo el sistema (solo Admin General)

ALTER TABLE public.in_app_notifications
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;

-- Índice para búsquedas por sede
CREATE INDEX IF NOT EXISTS idx_notifications_school
  ON public.in_app_notifications(school_id);

-- ── Actualizar política de lectura de padres ─────────────────────────────────
-- Los padres ven:
--   1. Su mensaje personal (user_id = ellos)
--   2. Mensajes globales de su sede (user_id IS NULL AND school_id = sede del hijo)
--   3. Mensajes globales del sistema (user_id IS NULL AND school_id IS NULL)

DROP POLICY IF EXISTS padres_select_notif ON public.in_app_notifications;

CREATE POLICY padres_select_notif
  ON public.in_app_notifications
  FOR SELECT
  TO authenticated
  USING (
    -- Es un mensaje personal directo
    user_id = auth.uid()
    OR
    -- Es global de su sede o global del sistema
    (
      user_id IS NULL
      AND (
        school_id IS NULL
        OR school_id IN (
          SELECT s.school_id
          FROM public.students s
          WHERE s.parent_id = auth.uid()
            AND s.is_active = true
        )
      )
    )
  );

-- ── Política de admins ───────────────────────────────────────────────────────
-- Los admins ya tienen política total (admins_all_notif), no necesita cambio.
-- Solo recreamos para asegurarnos de que incluye school_id correctamente.

DROP POLICY IF EXISTS admins_all_notif ON public.in_app_notifications;

CREATE POLICY admins_all_notif
  ON public.in_app_notifications
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'gestor_unidad', 'admin_general', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'gestor_unidad', 'admin_general', 'superadmin')
    )
  );
