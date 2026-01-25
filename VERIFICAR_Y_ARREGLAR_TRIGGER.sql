-- ====================================================================================================
-- VERIFICAR Y ARREGLAR EL TRIGGER DE CREACIÓN DE USUARIOS
-- ====================================================================================================

-- 1. Ver si el trigger existe
SELECT 
    trigger_name, 
    event_manipulation, 
    event_object_table
FROM 
    information_schema.triggers
WHERE 
    trigger_name LIKE '%handle_new_user%';

-- 2. Ver el contenido de la función del trigger
SELECT 
    routine_name, 
    routine_definition
FROM 
    information_schema.routines
WHERE 
    routine_name LIKE '%handle_new_user%';

-- ====================================================================================================
-- RECREAR EL TRIGGER CORRECTAMENTE (Ejecuta esto si falla)
-- ====================================================================================================

-- Eliminar trigger anterior si existe
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Crear la función del trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'parent'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error en handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear el trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ====================================================================================================
-- VERIFICAR QUE TODO FUNCIONA
-- ====================================================================================================

-- Ver los permisos de la tabla profiles
SELECT 
    grantee, 
    privilege_type
FROM 
    information_schema.role_table_grants
WHERE 
    table_name = 'profiles';
