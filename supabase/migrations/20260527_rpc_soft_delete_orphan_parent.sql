-- =============================================================================
-- 20260527_rpc_soft_delete_orphan_parent.sql
--
-- RPC: rpc_admin_soft_delete_orphan_parent
--
-- Propósito: Soft delete seguro de un padre que NO tiene alumnos vinculados
-- ("padre fantasma / huérfano").
--
-- Garantías de seguridad:
--   1. Solo ejecutable por admin (check_is_admin())
--   2. Bloquea si el padre tiene alumnos activos vinculados → error de negocio
--   3. NO hace DELETE físico — solo marca is_deleted = true
--   4. Registra deleted_at en hora Lima y deleted_by = auth.uid()
--   5. Idempotente: si ya estaba borrado, lanza PARENT_NOT_FOUND
--
-- Reglas de Oro respetadas:
--   - Hora de BD (America/Lima), no reloj del cliente
--   - SECURITY DEFINER + validación de rol
--   - Preserva historial financiero / contable intacto
--   - Todo cambio auditado (deleted_by, deleted_at)
--   - La búsqueda search_parents_v3 ya filtra is_deleted = false → desaparece
--     inmediatamente de la UI tras el soft delete
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_admin_soft_delete_orphan_parent(uuid);

CREATE OR REPLACE FUNCTION public.rpc_admin_soft_delete_orphan_parent(
  p_parent_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_user_id     uuid;
  v_child_count int  := 0;
BEGIN
  -- 1) Autenticación
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Debes iniciar sesión.'
      USING ERRCODE = '28000';
  END IF;

  -- 2) Autorización: solo admins
  IF COALESCE(public.check_is_admin(), false) = false THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Solo administradores pueden eliminar perfiles de padres.'
      USING ERRCODE = '42501';
  END IF;

  -- 3) Obtener el user_id del padre (FK hacia auth.users / profiles)
  --    El WHERE excluye ya borrados (idempotente)
  SELECT user_id
    INTO v_user_id
    FROM public.parent_profiles
   WHERE id = p_parent_id
     AND COALESCE(is_deleted, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARENT_NOT_FOUND: Padre no encontrado o ya eliminado.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4) Muralla de seguridad: no eliminar si tiene alumnos activos
  SELECT COUNT(*)
    INTO v_child_count
    FROM public.students
   WHERE parent_id = v_user_id
     AND COALESCE(is_active, true) = true;

  IF v_child_count > 0 THEN
    RAISE EXCEPTION
      'PARENT_HAS_CHILDREN: No se puede eliminar. El padre tiene % alumno(s) vinculado(s). Desvincula los alumnos primero.',
      v_child_count
      USING ERRCODE = 'P0001';
  END IF;

  -- 5) Soft delete: marca lógica + trazabilidad (hora Lima, actor)
  UPDATE public.parent_profiles
     SET is_deleted  = true,
         deleted_at  = timezone('America/Lima', now()),
         deleted_by  = v_actor
   WHERE id = p_parent_id;

  -- 6) El padre desaparece de search_parents_v3 (filtra is_deleted = false)
  --    El registro permanece intacto para auditoría contable.
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_soft_delete_orphan_parent(uuid) IS
  'Admin-only: soft delete de padre sin alumnos vinculados.
   Bloquea si tiene hijos activos. Registra deleted_by y deleted_at (Lima).
   El registro permanece en BD para auditoría; desaparece de search_parents_v3.';

GRANT EXECUTE ON FUNCTION public.rpc_admin_soft_delete_orphan_parent(uuid)
  TO authenticated;

COMMIT;

-- =============================================================================
-- Verificación post-ejecución (opcional):
--
-- SELECT id, full_name, is_deleted, deleted_at, deleted_by
-- FROM   public.parent_profiles
-- WHERE  is_deleted = true
-- ORDER  BY deleted_at DESC
-- LIMIT  10;
-- =============================================================================
