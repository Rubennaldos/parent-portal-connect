-- ============================================
-- FASE 1: BASE DE DATOS PARA SISTEMA DE PERFILES
-- ============================================
-- Ejecutar en: Supabase SQL Editor

-- ============================================
-- 1. ACTUALIZAR TABLA PROFILES
-- ============================================

-- Agregar columnas para POS
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS pos_number INTEGER,
ADD COLUMN IF NOT EXISTS ticket_prefix TEXT;

-- Comentarios
COMMENT ON COLUMN profiles.pos_number IS 'Número del punto de venta (1, 2, 3)';
COMMENT ON COLUMN profiles.ticket_prefix IS 'Prefijo del ticket (ej: FN1, FSG2)';

-- ============================================
-- 2. CREAR TABLA TICKET_SEQUENCES
-- ============================================

CREATE TABLE IF NOT EXISTS ticket_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  pos_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  current_number INTEGER DEFAULT 0,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, pos_user_id),
  UNIQUE(prefix)
);

COMMENT ON TABLE ticket_sequences IS 'Secuencias de tickets por cajero';
COMMENT ON COLUMN ticket_sequences.prefix IS 'Prefijo del ticket (FN1, FSG2, etc)';
COMMENT ON COLUMN ticket_sequences.current_number IS 'Número actual del correlativo';
COMMENT ON COLUMN ticket_sequences.last_reset_date IS 'Última fecha de reinicio automático';

-- ============================================
-- 3. CREAR FUNCIÓN: GET_NEXT_TICKET_NUMBER
-- ============================================

CREATE OR REPLACE FUNCTION get_next_ticket_number(p_pos_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_next_number INTEGER;
  v_ticket_code TEXT;
  v_last_reset DATE;
BEGIN
  -- Verificar si hay que reiniciar (nuevo día)
  SELECT last_reset_date INTO v_last_reset
  FROM ticket_sequences
  WHERE pos_user_id = p_pos_user_id;
  
  -- Si es un nuevo día, reiniciar contador
  IF v_last_reset IS NOT NULL AND v_last_reset < CURRENT_DATE THEN
    UPDATE ticket_sequences
    SET current_number = 0,
        last_reset_date = CURRENT_DATE,
        updated_at = now()
    WHERE pos_user_id = p_pos_user_id;
  END IF;
  
  -- Obtener prefijo y siguiente número
  UPDATE ticket_sequences
  SET current_number = current_number + 1,
      updated_at = now()
  WHERE pos_user_id = p_pos_user_id
  RETURNING prefix, current_number INTO v_prefix, v_next_number;
  
  -- Formatear ticket: FN1-001
  v_ticket_code := v_prefix || '-' || LPAD(v_next_number::TEXT, 3, '0');
  
  RETURN v_ticket_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_next_ticket_number IS 'Obtiene el siguiente número de ticket y reinicia automáticamente cada día';

-- ============================================
-- 4. ACTUALIZAR TABLA TRANSACTIONS
-- ============================================

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS ticket_code TEXT;

COMMENT ON COLUMN transactions.ticket_code IS 'Código del ticket (ej: FN1-042)';

-- ============================================
-- 5. CREAR ÍNDICES PARA PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ticket_sequences_pos_user 
ON ticket_sequences(pos_user_id);

CREATE INDEX IF NOT EXISTS idx_ticket_sequences_school 
ON ticket_sequences(school_id);

CREATE INDEX IF NOT EXISTS idx_transactions_ticket_code 
ON transactions(ticket_code);

CREATE INDEX IF NOT EXISTS idx_profiles_pos_number 
ON profiles(pos_number) WHERE pos_number IS NOT NULL;

-- ============================================
-- 6. POLÍTICAS RLS PARA TICKET_SEQUENCES
-- ============================================

-- Habilitar RLS
ALTER TABLE ticket_sequences ENABLE ROW LEVEL SECURITY;

-- El cajero solo ve su secuencia
CREATE POLICY "POS can view own sequence"
ON ticket_sequences FOR SELECT
TO authenticated
USING (pos_user_id = auth.uid());

-- Sistema puede insertar
CREATE POLICY "System can insert sequences"
ON ticket_sequences FOR INSERT
TO authenticated
WITH CHECK (true);

-- Sistema puede actualizar
CREATE POLICY "System can update sequences"
ON ticket_sequences FOR UPDATE
TO authenticated
USING (true);

-- SuperAdmin puede ver todo
CREATE POLICY "SuperAdmin can view all sequences"
ON ticket_sequences FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'superadmin'
  )
);

-- ============================================
-- 7. FUNCIÓN HELPER: CREAR SECUENCIA DE TICKETS
-- ============================================

CREATE OR REPLACE FUNCTION create_ticket_sequence(
  p_school_id UUID,
  p_pos_user_id UUID,
  p_prefix TEXT
)
RETURNS UUID AS $$
DECLARE
  v_sequence_id UUID;
BEGIN
  INSERT INTO ticket_sequences (
    school_id,
    pos_user_id,
    prefix,
    current_number,
    last_reset_date
  ) VALUES (
    p_school_id,
    p_pos_user_id,
    p_prefix,
    0,
    CURRENT_DATE
  )
  RETURNING id INTO v_sequence_id;
  
  RETURN v_sequence_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_ticket_sequence IS 'Crea una nueva secuencia de tickets para un cajero';

-- ============================================
-- 8. TABLA: PREFIJOS POR SEDE (CONFIGURACIÓN)
-- ============================================

CREATE TABLE IF NOT EXISTS school_prefixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE UNIQUE,
  prefix_base TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE school_prefixes IS 'Prefijos base de tickets por sede';

-- Insertar prefijos para las 7 sedes
INSERT INTO school_prefixes (school_id, prefix_base)
SELECT 
  id,
  CASE code
    WHEN 'NRD' THEN 'FN'
    WHEN 'SGV' THEN 'FSG'
    WHEN 'SGM' THEN 'FSGM'
    WHEN 'LSG' THEN 'FLSG'
    WHEN 'JLB' THEN 'FJL'
    WHEN 'MC1' THEN 'FMC1'
    WHEN 'MC2' THEN 'FMC2'
  END
FROM schools
WHERE code IN ('NRD', 'SGV', 'SGM', 'LSG', 'JLB', 'MC1', 'MC2')
ON CONFLICT (school_id) DO NOTHING;

-- ============================================
-- 9. FUNCIÓN: OBTENER SIGUIENTE NÚMERO POS POR SEDE
-- ============================================

CREATE OR REPLACE FUNCTION get_next_pos_number(p_school_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  -- Contar cuántos POS ya existen en esa sede
  SELECT COALESCE(MAX(pos_number), 0) + 1
  INTO v_next_number
  FROM profiles
  WHERE school_id = p_school_id
  AND role = 'pos'
  AND pos_number IS NOT NULL;
  
  -- Validar que no exceda el límite de 3
  IF v_next_number > 3 THEN
    RAISE EXCEPTION 'La sede ya tiene el máximo de 3 puntos de venta';
  END IF;
  
  RETURN v_next_number;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_next_pos_number IS 'Obtiene el siguiente número disponible para POS en una sede (máximo 3)';

-- ============================================
-- 10. FUNCIÓN: GENERAR PREFIJO COMPLETO
-- ============================================

CREATE OR REPLACE FUNCTION generate_ticket_prefix(p_school_id UUID, p_pos_number INTEGER)
RETURNS TEXT AS $$
DECLARE
  v_base_prefix TEXT;
  v_full_prefix TEXT;
BEGIN
  -- Obtener prefijo base de la sede
  SELECT prefix_base INTO v_base_prefix
  FROM school_prefixes
  WHERE school_id = p_school_id;
  
  IF v_base_prefix IS NULL THEN
    RAISE EXCEPTION 'No se encontró prefijo para la sede';
  END IF;
  
  -- Generar prefijo completo: FN + 1 = FN1
  v_full_prefix := v_base_prefix || p_pos_number::TEXT;
  
  RETURN v_full_prefix;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_ticket_prefix IS 'Genera el prefijo completo del ticket (ej: FN1, FSG2)';

-- ============================================
-- 11. VERIFICAR QUE TODO SE CREÓ CORRECTAMENTE
-- ============================================

-- Ver prefijos configurados
SELECT 
  s.name as "Sede",
  s.code as "Código",
  sp.prefix_base as "Prefijo Base"
FROM schools s
LEFT JOIN school_prefixes sp ON sp.school_id = s.id
ORDER BY s.name;

-- Ver estructura de ticket_sequences
\d ticket_sequences

-- Ver funciones creadas
SELECT proname as "Función" 
FROM pg_proc 
WHERE proname IN (
  'get_next_ticket_number',
  'create_ticket_sequence',
  'get_next_pos_number',
  'generate_ticket_prefix'
);

-- ============================================
-- ✅ FASE 1 COMPLETADA
-- ============================================
-- Siguiente: FASE 2 - Dashboard SuperAdmin
-- ============================================

