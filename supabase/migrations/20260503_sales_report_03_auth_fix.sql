-- ============================================================
-- BLOQUE 1 — Fix de autorización para reportes
-- ============================================================
-- Problema:
-- - La UI toma rol desde profiles.role.
-- - El SQL original validaba solo auth.jwt()->>'role'.
-- - En varios entornos ese claim no viene poblado, causando 400 con
--   REPORTS_ACCESS_DENIED aunque el usuario sea admin_general.
--
-- Solución profesional y simple:
-- - Unificar validación en public.is_reports_admin():
--   1) role en JWT root
--   2) role en app_metadata
--   3) role en user_metadata
--   4) fallback a profiles.role por auth.uid()
-- - Reusar esa función tanto en RLS (is_admin_general_jwt) como en RPC
--   (fn_assert_admin_general), manteniendo compatibilidad.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_reports_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_role   text;
  v_profile_role text;
BEGIN
  -- 1) Claim en JWT (root / app_metadata / user_metadata)
  v_claim_role := COALESCE(
    NULLIF(auth.jwt() ->> 'role', ''),
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'role', '')
  );

  IF v_claim_role = 'admin_general' THEN
    RETURN true;
  END IF;

  -- 2) Fallback robusto al perfil real en BD
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role
    INTO v_profile_role
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;

  RETURN COALESCE(v_profile_role = 'admin_general', false);
END;
$$;

COMMENT ON FUNCTION public.is_reports_admin IS
  'Valida acceso de reportes leyendo role desde JWT y, si no existe, desde profiles.role.';

-- Mantener compatibilidad con policies ya existentes:
CREATE OR REPLACE FUNCTION public.is_admin_general_jwt()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_reports_admin();
$$;

COMMENT ON FUNCTION public.is_admin_general_jwt IS
  'Compatibilidad histórica: usa is_reports_admin() para validar acceso de reportes.';

-- Alinear guard de RPC con la misma regla de acceso:
CREATE OR REPLACE FUNCTION public.fn_assert_admin_general()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF NOT public.is_reports_admin() THEN
    RAISE EXCEPTION 'REPORTS_ACCESS_DENIED: Solo admin_general puede ejecutar este reporte.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_reports_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_general_jwt() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fn_assert_admin_general() TO authenticated, anon;
