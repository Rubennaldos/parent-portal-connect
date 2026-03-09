-- =====================================================
-- FIX: Ampliar roles aceptados para forzar cierre de caja
-- Problema: Admin de sede (gestor_unidad) ingresaba su contraseña
-- y decía "incorrecta" - la función ya incluía gestor_unidad,
-- pero agregamos admin_sede, supervisor_red y superadmin por si
-- alguna sede usa roles alternativos.
-- =====================================================

-- Asegurar que pgcrypto esté habilitado (necesario para crypt())
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Recrear función con roles ampliados
DROP FUNCTION IF EXISTS validate_admin_password(text);

CREATE OR REPLACE FUNCTION validate_admin_password(p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_user_id uuid;
  v_role varchar;
BEGIN
  SELECT au.id, p.role INTO v_user_id, v_role
  FROM auth.users au
  INNER JOIN profiles p ON p.id = au.id
  WHERE au.encrypted_password IS NOT NULL
    AND au.encrypted_password != ''
    AND au.encrypted_password = crypt(p_password, au.encrypted_password)
    AND p.role IN ('admin_general','gestor_unidad','admin_sede','supervisor_red','superadmin')
    AND au.deleted_at IS NULL
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    RETURN true;
  ELSE
    RETURN false;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$func$;

GRANT EXECUTE ON FUNCTION validate_admin_password(text) TO authenticated;

COMMENT ON FUNCTION validate_admin_password IS 'Valida si una contraseña corresponde a un administrador (general, sede, supervisor o superadmin)';
