-- ====================================================================================================
-- EDGE FUNCTION: create-user
--
-- Esta función crea un nuevo usuario desde el lado del servidor sin afectar la sesión del admin
-- ====================================================================================================

-- 1. CREAR LA FUNCIÓN RPC EN SUPABASE
-- Ve a: Supabase Dashboard → SQL Editor → Ejecuta esto:

CREATE OR REPLACE FUNCTION create_user_as_admin(
  user_email TEXT,
  user_password TEXT,
  user_full_name TEXT,
  user_role TEXT,
  user_school_id UUID DEFAULT NULL,
  user_pos_number INT DEFAULT NULL,
  user_ticket_prefix TEXT DEFAULT NULL,
  user_dni TEXT DEFAULT NULL,
  user_phone_1 TEXT DEFAULT NULL,
  user_address TEXT DEFAULT NULL,
  user_nickname TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_user_id UUID;
  result JSON;
BEGIN
  -- Verificar que el usuario actual sea admin_general o superadmin
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('admin_general', 'superadmin', 'supervisor_red')
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para crear usuarios';
  END IF;

  -- Nota: Esta función NO puede crear usuarios en auth.users directamente
  -- Necesitas usar el Admin API de Supabase desde el cliente
  -- Pero SÍ podemos preparar los datos para que el trigger funcione correctamente
  
  RETURN json_build_object(
    'success', true,
    'message', 'Debes usar el Admin API de Supabase'
  );
END;
$$;

-- ====================================================================================================
-- INSTRUCCIONES PARA CONFIGURAR EL ADMIN API
-- ====================================================================================================

-- 1. Ve a tu proyecto de Supabase
-- 2. Settings → API
-- 3. Copia el "service_role" key (¡NUNCA lo expongas en el cliente!)
-- 4. Debes crear una Edge Function para crear usuarios de forma segura
