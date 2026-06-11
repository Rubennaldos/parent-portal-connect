-- ============================================================================
-- Support Directory RPC bridge (sin cambios a RLS)
-- 2026-05-24
--
-- Objetivo:
-- - Guardado seguro de soporte técnico general en app_settings.
-- - Guardado seguro de administradora/WhatsApp por sede en schools.
-- - Evitar bloqueos por RLS en operaciones directas desde frontend.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'support_technical_contact',
  jsonb_build_object(
    'admin_name', 'Beto',
    'technical_whatsapp', '51991236870'
  ),
  'Contacto técnico central para panel de Comunicados'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_support_technical_contact(
  p_admin_name text,
  p_technical_whatsapp text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no autenticado';
  END IF;

  SELECT p.role
    INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF COALESCE(v_role, '') NOT IN ('admin_general', 'superadmin') THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permisos para actualizar soporte técnico';
  END IF;

  v_phone := regexp_replace(COALESCE(p_technical_whatsapp, ''), '\D', '', 'g');
  IF v_phone = '' THEN
    v_phone := NULL;
  END IF;

  IF v_phone IS NOT NULL AND length(v_phone) NOT BETWEEN 10 AND 15 THEN
    RAISE EXCEPTION 'INVALID_PHONE: el WhatsApp debe tener entre 10 y 15 dígitos';
  END IF;

  INSERT INTO public.app_settings (key, value, description)
  VALUES (
    'support_technical_contact',
    jsonb_build_object(
      'admin_name', NULLIF(btrim(COALESCE(p_admin_name, '')), ''),
      'technical_whatsapp', v_phone
    ),
    'Contacto técnico central para panel de Comunicados'
  )
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_support_technical_contact(text, text)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_school_support_contact(
  p_school_id uuid,
  p_admin_name text,
  p_admin_whatsapp text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no autenticado';
  END IF;

  SELECT p.role
    INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF COALESCE(v_role, '') NOT IN ('admin_general', 'superadmin') THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permisos para actualizar sedes';
  END IF;

  v_phone := regexp_replace(COALESCE(p_admin_whatsapp, ''), '\D', '', 'g');
  IF v_phone = '' THEN
    v_phone := NULL;
  END IF;

  IF v_phone IS NOT NULL AND length(v_phone) NOT BETWEEN 10 AND 15 THEN
    RAISE EXCEPTION 'INVALID_PHONE: el WhatsApp debe tener entre 10 y 15 dígitos';
  END IF;

  UPDATE public.schools
     SET admin_name     = NULLIF(btrim(COALESCE(p_admin_name, '')), ''),
         admin_whatsapp = v_phone
   WHERE id = p_school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHOOL_NOT_FOUND: sede no encontrada';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_school_support_contact(uuid, text, text)
TO authenticated, service_role;

SELECT 'OK: RPC bridge soporte técnico + sedes' AS resultado;
