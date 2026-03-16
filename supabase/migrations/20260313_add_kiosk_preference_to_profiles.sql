-- Agregar columna kiosk_preference a profiles
-- Guarda la preferencia del padre elegida en el onboarding:
--   'full'       = Cuenta Libre (puede comprar en kiosco) — valor por defecto
--   'lunch_only' = Solo Almuerzos (kiosco desactivado para todos sus hijos)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kiosk_preference TEXT DEFAULT 'full';

-- Los padres que ya completaron el onboarding sin esta columna
-- quedan como 'full' (comportamiento actual, no rompemos nada)
