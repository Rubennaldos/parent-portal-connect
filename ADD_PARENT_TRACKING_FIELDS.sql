-- =====================================================
-- AGREGAR CAMPOS DE TRACKING Y RESPONSABLES DE PAGO
-- Para capturar datos completos del padre y responsables
-- =====================================================

-- PASO 1: Agregar columnas para el responsable principal (padre que se registra)
ALTER TABLE parent_profiles
ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) DEFAULT 'DNI',
ADD COLUMN IF NOT EXISTS dni VARCHAR(20),
ADD COLUMN IF NOT EXISTS phone_1 VARCHAR(20),
ADD COLUMN IF NOT EXISTS address TEXT;

-- PASO 2: Agregar columnas para el segundo responsable de pago
ALTER TABLE parent_profiles
ADD COLUMN IF NOT EXISTS responsible_2_full_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS responsible_2_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS responsible_2_document_type VARCHAR(50) DEFAULT 'DNI',
ADD COLUMN IF NOT EXISTS responsible_2_dni VARCHAR(20),
ADD COLUMN IF NOT EXISTS responsible_2_phone_1 VARCHAR(20),
ADD COLUMN IF NOT EXISTS responsible_2_address TEXT;

-- PASO 3: Agregar campo para aceptación de cláusula legal
ALTER TABLE parent_profiles
ADD COLUMN IF NOT EXISTS legal_acceptance BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS legal_acceptance_timestamp TIMESTAMPTZ;

-- PASO 4: Agregar campo JSONB para metadata (navegador, OS, IP, etc.)
-- Este campo almacenará de forma automática y sutil:
-- - Navegador y versión
-- - Sistema operativo
-- - Resolución de pantalla
-- - Zona horaria
-- - Idioma del navegador
-- - Timestamp de registro
ALTER TABLE parent_profiles
ADD COLUMN IF NOT EXISTS registration_metadata JSONB;

-- PASO 5: Agregar campo updated_at para rastrear última actualización
ALTER TABLE parent_profiles
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- PASO 6: Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_parent_profiles_dni ON parent_profiles(dni);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_phone ON parent_profiles(phone_1);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_legal ON parent_profiles(legal_acceptance);

-- PASO 7: Comentarios para documentación
COMMENT ON COLUMN parent_profiles.full_name IS 'Nombres completos del responsable principal';
COMMENT ON COLUMN parent_profiles.document_type IS 'Tipo de documento: DNI, Pasaporte, Otro';
COMMENT ON COLUMN parent_profiles.dni IS 'Número de documento de identidad';
COMMENT ON COLUMN parent_profiles.phone_1 IS 'Teléfono del responsable principal';
COMMENT ON COLUMN parent_profiles.address IS 'Dirección del responsable principal';

COMMENT ON COLUMN parent_profiles.responsible_2_full_name IS 'Nombres completos del segundo responsable de pago';
COMMENT ON COLUMN parent_profiles.responsible_2_email IS 'Email del segundo responsable (opcional)';
COMMENT ON COLUMN parent_profiles.responsible_2_document_type IS 'Tipo de documento del segundo responsable';
COMMENT ON COLUMN parent_profiles.responsible_2_dni IS 'Número de documento del segundo responsable';
COMMENT ON COLUMN parent_profiles.responsible_2_phone_1 IS 'Teléfono del segundo responsable';
COMMENT ON COLUMN parent_profiles.responsible_2_address IS 'Dirección del segundo responsable (opcional)';

COMMENT ON COLUMN parent_profiles.legal_acceptance IS 'Aceptación de cláusula legal para cobranza judicial';
COMMENT ON COLUMN parent_profiles.legal_acceptance_timestamp IS 'Fecha y hora de aceptación de la cláusula legal';
COMMENT ON COLUMN parent_profiles.registration_metadata IS 'Metadata capturada automáticamente durante el registro';
COMMENT ON COLUMN parent_profiles.updated_at IS 'Última actualización de los datos';

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
