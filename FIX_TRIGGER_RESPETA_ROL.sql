-- =====================================================
-- FIX: Trigger que RESPETA el rol desde metadata
-- =====================================================
-- Este trigger crea perfiles automáticamente al registrarse
-- y usa el rol que viene en raw_user_meta_data si existe

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Obtener el rol de los metadatos, o usar 'parent' por defecto
  user_role := COALESCE((NEW.raw_user_meta_data->>'role')::TEXT, 'parent');
  
  RAISE LOG 'Creando perfil para % con rol: %', NEW.email, user_role;

  -- Insertar el perfil con el rol correcto
  INSERT INTO public.profiles (
    id,
    email,
    role,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    user_role, -- 🔥 Usar el rol que viene en metadata
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    role = EXCLUDED.role; -- 🔥 Actualizar el rol si ya existe

  RAISE LOG 'Perfil creado exitosamente para: % con rol: %', NEW.email, user_role;
  
  RETURN NEW;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error al crear perfil para %: % %', NEW.email, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

-- Crear el trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- VERIFICACIÓN
-- =====================================================
SELECT 'Trigger actualizado correctamente' as status;

