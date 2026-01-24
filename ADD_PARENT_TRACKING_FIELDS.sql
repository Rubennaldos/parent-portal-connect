-- Añadir campos de datos personales y tracking a parent_profiles
-- Incluye datos de DOS responsables de pago

ALTER TABLE public.parent_profiles
-- RESPONSABLE 1 (Principal)
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS dni TEXT,
ADD COLUMN IF NOT EXISTS phone_1 TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'DNI',
ADD COLUMN IF NOT EXISTS document_number TEXT,

-- RESPONSABLE 2 (Secundario)
ADD COLUMN IF NOT EXISTS full_name_2 TEXT,
ADD COLUMN IF NOT EXISTS email_2 TEXT,
ADD COLUMN IF NOT EXISTS dni_2 TEXT,
ADD COLUMN IF NOT EXISTS phone_2 TEXT,
ADD COLUMN IF NOT EXISTS address_2 TEXT, -- Opcional para el segundo
ADD COLUMN IF NOT EXISTS document_type_2 TEXT DEFAULT 'DNI',
ADD COLUMN IF NOT EXISTS document_number_2 TEXT,

-- ACEPTACIÓN LEGAL
ADD COLUMN IF NOT EXISTS legal_acceptance BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS legal_acceptance_date TIMESTAMP WITH TIME ZONE,

-- TRACKING (captura automática discreta)
ADD COLUMN IF NOT EXISTS browser_info TEXT,
ADD COLUMN IF NOT EXISTS os_info TEXT,
ADD COLUMN IF NOT EXISTS screen_resolution TEXT,
ADD COLUMN IF NOT EXISTS timezone TEXT,
ADD COLUMN IF NOT EXISTS language TEXT,
ADD COLUMN IF NOT EXISTS registration_ip INET,
ADD COLUMN IF NOT EXISTS registration_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_parent_profiles_dni ON public.parent_profiles (dni);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_dni_2 ON public.parent_profiles (dni_2);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_phone_1 ON public.parent_profiles (phone_1);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_phone_2 ON public.parent_profiles (phone_2);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_email ON public.parent_profiles (email);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_email_2 ON public.parent_profiles (email_2);

-- Actualizar la tabla profiles para que también tenga los campos de contacto principales
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS phone_1 TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS document_type TEXT,
ADD COLUMN IF NOT EXISTS document_number TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Comentario informativo
COMMENT ON COLUMN public.parent_profiles.legal_acceptance IS 'Acepta que sus datos sean usados para cobranza judicial';
COMMENT ON COLUMN public.parent_profiles.address_2 IS 'Dirección del segundo responsable (opcional)';
