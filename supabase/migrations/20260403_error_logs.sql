-- ============================================================
-- TABLA error_logs — Registro persistente de errores del sistema
-- Fecha: 2026-04-03
--
-- PROPÓSITO:
--   Capturar errores críticos que antes solo iban a console.error.
--   Permite auditoría post-mortem, soporte técnico y alertas proactivas.
--   Sigue el mismo patrón de auto_billing_logs y huella_digital_logs.
--
-- FLUJO:
--   Frontend/Edge Function → logError(module, message, context)
--   → INSERT en error_logs → visible en panel de admin (futuro)
--
-- NOTA: La tabla NO tiene FK obligatorias en school_id/user_id para que
--   un error de red o de sesión no impida insertar el log. Mejor un log
--   incompleto que ninguno.
-- ============================================================

-- La tabla puede existir con un esquema previo diferente.
-- Usamos ADD COLUMN IF NOT EXISTS para agregar solo lo que falte,
-- sin tocar datos ni columnas que ya existan.
CREATE TABLE IF NOT EXISTS public.error_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS school_id   uuid;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS user_id     uuid;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS module      text NOT NULL DEFAULT 'general';
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS error_code  text;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS message     text NOT NULL DEFAULT '';
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS context     jsonb;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS resolved    boolean NOT NULL DEFAULT false;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS resolved_by uuid;

-- Quitar defaults temporales usados solo para el NOT NULL de columnas nuevas
-- (los valores futuros los provee el helper logError)
ALTER TABLE public.error_logs ALTER COLUMN module  DROP DEFAULT;
ALTER TABLE public.error_logs ALTER COLUMN message DROP DEFAULT;

-- Índices para consultas frecuentes del panel de admin
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at  ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_module       ON public.error_logs (module);
CREATE INDEX IF NOT EXISTS idx_error_logs_school_id    ON public.error_logs (school_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved     ON public.error_logs (resolved) WHERE resolved = false;

-- RLS: solo staff puede leer; el INSERT se hace con service_role desde el helper
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Staff (admin/gestor) puede leer logs de su sede
DROP POLICY IF EXISTS "error_logs_read_staff" ON public.error_logs;
CREATE POLICY "error_logs_read_staff" ON public.error_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('superadmin', 'admin_general')
          OR (p.school_id = error_logs.school_id
              AND p.role IN ('gestor_unidad', 'contadora'))
        )
    )
  );

-- INSERT: cualquier usuario autenticado puede insertar su propio error
-- (el helper logError usa el cliente con JWT del usuario)
DROP POLICY IF EXISTS "error_logs_insert_any_auth" ON public.error_logs;
CREATE POLICY "error_logs_insert_any_auth" ON public.error_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Resolución: solo admins pueden marcar como resuelto
DROP POLICY IF EXISTS "error_logs_update_admin" ON public.error_logs;
CREATE POLICY "error_logs_update_admin" ON public.error_logs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'admin_general', 'gestor_unidad')
    )
  );

SELECT '20260403_error_logs ✅ Tabla error_logs creada con RLS' AS resultado;
