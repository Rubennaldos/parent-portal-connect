-- =====================================================
-- FIX: Trigger de Registro con OAuth (Google)
-- =====================================================
-- Este script arregla el trigger que crea perfiles automáticamente
-- cuando un usuario se registra con Google OAuth

-- PASO 1: Eliminar el trigger y función existente si hay problemas
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- PASO 2: Crear una función mejorada que maneje errores
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  user_school_id UUID;
BEGIN
  -- Log para debugging
  RAISE LOG 'Creando perfil para usuario: %', NEW.id;
  
  -- Intentar obtener el school_id de los metadatos del usuario (si viene del registro)
  user_school_id := (NEW.raw_user_meta_data->>'school_id')::UUID;
  
  -- Si no hay school_id en los metadatos, dejarlo NULL (se puede asignar después)
  IF user_school_id IS NULL THEN
    RAISE LOG 'Usuario sin school_id asignado: %', NEW.id;
  END IF;

  -- Insertar el perfil con valores por defecto
  INSERT INTO public.profiles (
    id,
    email,
    role,
    school_id,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::text, 'parent'), -- Por defecto 'parent'
    user_school_id, -- Puede ser NULL
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    updated_at = NOW();

  RAISE LOG 'Perfil creado exitosamente para: %', NEW.email;
  
  RETURN NEW;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log del error pero NO fallar el registro
    RAISE WARNING 'Error al crear perfil para %: % %', NEW.email, SQLERRM, SQLSTATE;
    -- Retornar NEW para que el usuario se cree igual en auth.users
    RETURN NEW;
END;
$$;

-- PASO 3: Crear el trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- PASO 4: Verificar que las políticas RLS permitan la creación
-- Política para que el trigger pueda insertar en profiles
DROP POLICY IF EXISTS "Service role can insert profiles" ON profiles;
CREATE POLICY "Service role can insert profiles"
  ON profiles
  FOR INSERT
  WITH CHECK (true);

-- Política para que los usuarios puedan ver su propio perfil
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Política para que los usuarios puedan actualizar su propio perfil
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- =====================================================
-- VERIFICACIÓN
-- =====================================================

-- Ver el trigger creado
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Ver las políticas de la tabla profiles
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

-- =====================================================
-- INSTRUCCIONES
-- =====================================================
-- 1. Ejecuta este script COMPLETO en Supabase SQL Editor
-- 2. Verifica que se ejecute sin errores
-- 3. Espera 1-2 minutos
-- 4. Prueba de nuevo el registro con Google OAuth
-- 5. Si sigue fallando, revisa los logs en:
--    Supabase Dashboard → Database → Logs


