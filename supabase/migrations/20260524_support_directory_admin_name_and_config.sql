-- ============================================================================
-- Directorio de Soporte y Sedes (Comunicados)
-- 2026-05-24
--
-- Objetivo:
-- - Agregar schools.admin_name para identificar administradora por sede.
-- - Registrar configuración global editable de soporte técnico en app_config.
-- - Sin cambios de RLS ni permisos.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_config (
  key         text PRIMARY KEY,
  value_json  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admin_name character varying(120);

COMMENT ON COLUMN public.schools.admin_name IS
  'Nombre de la administradora/encargada de la sede para canal de soporte.';

INSERT INTO public.app_config (key, value_json)
VALUES (
  'support_technical_contact',
  jsonb_build_object(
    'admin_name', 'Beto',
    'technical_whatsapp', '51991236870'
  )
)
ON CONFLICT (key) DO NOTHING;

SELECT 'OK: schools.admin_name + app_config.support_technical_contact' AS resultado;
