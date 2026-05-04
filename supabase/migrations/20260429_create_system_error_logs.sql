-- ============================================================
-- system_error_logs: bitacora global de errores de interfaz
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  error_message text NOT NULL,
  stack_trace text NULL,
  component_name text NULL,
  metadata jsonb NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_system_error_logs_created_at
  ON public.system_error_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_error_logs_user_id
  ON public.system_error_logs (user_id);

ALTER TABLE public.system_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_error_logs_insert_all" ON public.system_error_logs;
CREATE POLICY "system_error_logs_insert_all"
  ON public.system_error_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "system_error_logs_select_admin" ON public.system_error_logs;
CREATE POLICY "system_error_logs_select_admin"
  ON public.system_error_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'admin_general')
    )
  );

SELECT '20260429_create_system_error_logs ✅' AS resultado;
