-- =====================================================
-- FIX: Trigger que RESPETA el rol desde metadata
-- =====================================================
-- Ejecuta este script en el SQL Editor de Supabase para
-- que el sistema reconozca automáticamente si el usuario
-- es un PADRE o un PROFESOR al momento de registrarse.

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
  -- 1. Obtener el rol de los metadatos, o usar 'parent' por defecto
  user_role := COALESCE((NEW.raw_user_meta_data->>'role')::TEXT, 'parent');
  
  -- 2. Insertar el perfil base con el rol correcto
  INSERT INTO public.profiles (
    id,
    email,
    role,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    user_role,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    role = EXCLUDED.role;

  -- 3. Si el rol es 'teacher', podemos crear una entrada inicial en teacher_profiles
  -- (Opcional, ya que el onboarding lo hará de todas formas)
  /*
  IF user_role = 'teacher' THEN
    INSERT INTO public.teacher_profiles (id, full_name, onboarding_completed)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  */

  RETURN NEW;
  
EXCEPTION
  WHEN OTHERS THEN
    -- En caso de error, registrarlo pero permitir que el usuario se cree en Auth
    RAISE WARNING 'Error al crear perfil para %: % %', NEW.email, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

-- Crear el trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Verificar que los roles permitidos estén actualizados
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
  END IF;
  
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
    CHECK (role IN (
      'superadmin', 
      'admin_general', 
      'gestor_unidad', 
      'almacenero', 
      'operador_caja', 
      'operador_cocina', 
      'supervisor_red', 
      'parent',
      'teacher'
    ));
END $$;
