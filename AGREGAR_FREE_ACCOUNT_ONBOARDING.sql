-- =====================================================
-- Agregar columna para controlar onboarding de cuenta libre
-- =====================================================

-- Agregar columna a la tabla profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS free_account_onboarding_completed BOOLEAN DEFAULT false;

-- Comentario
COMMENT ON COLUMN public.profiles.free_account_onboarding_completed 
IS 'Indica si el padre completó el onboarding de cuenta libre';

-- Mensaje de confirmación
SELECT '✅ Columna free_account_onboarding_completed agregada correctamente' AS status;
