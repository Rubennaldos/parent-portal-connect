-- =============================================================================
-- 20260527_parent_crm_rpc_role_hardening.sql
--
-- Endurece permisos de RPC de mini-CRM de padres:
-- - rpc_admin_update_parent_behavior
-- - rpc_admin_toggle_parent_suspension
--
-- Acceso permitido:
-- - Admin de plataforma (public.check_is_admin())
-- - Gestor/Admin de sede (roles: gestor_unidad, admin_sede) solo dentro de su sede
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_parent_behavior(
  p_parent_id uuid,
  p_profile public.parent_behavior_profile,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actor_school_id uuid;
  v_parent_school_id uuid;
  v_is_platform_admin boolean := COALESCE(public.check_is_admin(), false);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Debes iniciar sesión.'
      USING ERRCODE = '28000';
  END IF;

  SELECT p.role, p.school_id
    INTO v_actor_role, v_actor_school_id
  FROM public.profiles p
  WHERE p.id = v_actor
  LIMIT 1;

  SELECT pp.school_id
    INTO v_parent_school_id
  FROM public.parent_profiles pp
  WHERE pp.id = p_parent_id
    AND COALESCE(pp.is_deleted, false) = false
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARENT_NOT_FOUND: Padre no encontrado o eliminado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_is_platform_admin
    OR v_actor_role IN ('gestor_unidad', 'admin_sede')
  ) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Solo admins o gestores de sede pueden actualizar el mini-CRM.'
      USING ERRCODE = '42501';
  END IF;

  -- Gestor/Admin de sede: solo su propia sede
  IF NOT v_is_platform_admin THEN
    IF v_actor_school_id IS NULL OR v_actor_school_id IS DISTINCT FROM v_parent_school_id THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Solo puedes editar padres de tu sede.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.parent_profiles
     SET behavior_profile = p_profile,
         behavior_notes   = NULLIF(BTRIM(COALESCE(p_notes, '')), '')
   WHERE id = p_parent_id
     AND COALESCE(is_deleted, false) = false;
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_update_parent_behavior(uuid, public.parent_behavior_profile, text) IS
  'Actualiza perfil de comportamiento y nota interna del padre. Acceso: check_is_admin() o gestor/admin_sede de la misma sede.';

GRANT EXECUTE ON FUNCTION public.rpc_admin_update_parent_behavior(uuid, public.parent_behavior_profile, text)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.rpc_admin_toggle_parent_suspension(
  p_parent_id uuid,
  p_suspend boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actor_school_id uuid;
  v_parent_school_id uuid;
  v_is_platform_admin boolean := COALESCE(public.check_is_admin(), false);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Debes iniciar sesión.'
      USING ERRCODE = '28000';
  END IF;

  SELECT p.role, p.school_id
    INTO v_actor_role, v_actor_school_id
  FROM public.profiles p
  WHERE p.id = v_actor
  LIMIT 1;

  SELECT pp.school_id
    INTO v_parent_school_id
  FROM public.parent_profiles pp
  WHERE pp.id = p_parent_id
    AND COALESCE(pp.is_deleted, false) = false
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARENT_NOT_FOUND: Padre no encontrado o eliminado.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_is_platform_admin
    OR v_actor_role IN ('gestor_unidad', 'admin_sede')
  ) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Solo admins o gestores de sede pueden suspender/reactivar cuentas.'
      USING ERRCODE = '42501';
  END IF;

  -- Gestor/Admin de sede: solo su propia sede
  IF NOT v_is_platform_admin THEN
    IF v_actor_school_id IS NULL OR v_actor_school_id IS DISTINCT FROM v_parent_school_id THEN
      RAISE EXCEPTION 'ACCESS_DENIED: Solo puedes gestionar padres de tu sede.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.parent_profiles
     SET is_suspended = COALESCE(p_suspend, false)
   WHERE id = p_parent_id
     AND COALESCE(is_deleted, false) = false;
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_toggle_parent_suspension(uuid, boolean) IS
  'Suspende/reactiva una cuenta de padre. Acceso: check_is_admin() o gestor/admin_sede de la misma sede.';

GRANT EXECUTE ON FUNCTION public.rpc_admin_toggle_parent_suspension(uuid, boolean)
  TO authenticated;

COMMIT;
