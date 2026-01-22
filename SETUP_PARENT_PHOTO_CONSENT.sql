-- ============================================
-- SETUP: Sistema de Consentimiento de Fotografía
-- ============================================
-- Crea la tabla parent_profiles para almacenar
-- el consentimiento de uso de fotografías
-- ============================================

-- Crear tabla parent_profiles si no existe
CREATE TABLE IF NOT EXISTS public.parent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_consent BOOLEAN DEFAULT false,
  photo_consent_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_parent_profiles_user_id ON public.parent_profiles(user_id);

-- RLS: Habilitar Row Level Security
ALTER TABLE public.parent_profiles ENABLE ROW LEVEL SECURITY;

-- Política: Los padres solo pueden ver y editar su propio perfil
DROP POLICY IF EXISTS "Parents can view own profile" ON public.parent_profiles;
CREATE POLICY "Parents can view own profile"
  ON public.parent_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Parents can update own profile" ON public.parent_profiles;
CREATE POLICY "Parents can update own profile"
  ON public.parent_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Parents can insert own profile" ON public.parent_profiles;
CREATE POLICY "Parents can insert own profile"
  ON public.parent_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Trigger para actualizar updated_at automáticamente
DROP TRIGGER IF EXISTS trigger_update_parent_profiles_updated_at ON public.parent_profiles;

CREATE OR REPLACE FUNCTION update_parent_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_parent_profiles_updated_at
  BEFORE UPDATE ON public.parent_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_profiles_updated_at();

-- Mensaje final
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Sistema de consentimiento de fotografía configurado correctamente';
END $$;
