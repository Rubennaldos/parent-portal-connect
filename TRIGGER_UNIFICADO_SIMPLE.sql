-- ================================================
-- TRIGGER UNIFICADO (FLUJO CANVA)
-- ================================================
-- Este trigger es lo más simple posible para permitir
-- que el usuario se cree y luego el frontend maneje los datos.
-- ================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Crear Profile (Rol por defecto: parent)
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (
    NEW.id, 
    NEW.email, 
    'parent', 
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email;

  -- 2. Crear Parent Profile vacío
  INSERT INTO public.parent_profiles (user_id, onboarding_completed)
  VALUES (NEW.id, false)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
