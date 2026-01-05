-- =====================================================
-- SISTEMA COMPLETO DE COBRANZAS LIMA CAFÉ 28
-- =====================================================
-- Este script crea todas las tablas necesarias para el
-- módulo de cobranzas con períodos, pagos y control

-- =====================================================
-- 1. ACTUALIZAR TABLA parent_profiles
-- =====================================================
-- Agregar campos para gestionar tipos de cuenta

ALTER TABLE parent_profiles 
ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'free_account' CHECK (account_type IN ('recharge', 'free_account', 'hybrid'));

ALTER TABLE parent_profiles 
ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(10,2) DEFAULT NULL;

ALTER TABLE parent_profiles 
ADD COLUMN IF NOT EXISTS current_balance DECIMAL(10,2) DEFAULT 0.00;

COMMENT ON COLUMN parent_profiles.account_type IS 'Tipo de cuenta: recharge (solo prepago), free_account (consume y cobra después), hybrid (ambos)';
COMMENT ON COLUMN parent_profiles.daily_limit IS 'Límite diario de consumo (opcional, solo si aplica)';
COMMENT ON COLUMN parent_profiles.current_balance IS 'Saldo actual disponible (solo para recharge y hybrid)';

-- =====================================================
-- 2. CREAR TABLA billing_periods (Períodos de Cobranza)
-- =====================================================

CREATE TABLE IF NOT EXISTS billing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  visible_to_parents BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

COMMENT ON TABLE billing_periods IS 'Períodos de cobranza configurables por sede';
COMMENT ON COLUMN billing_periods.status IS 'draft: en preparación, open: visible para padres, closed: cerrado';
COMMENT ON COLUMN billing_periods.visible_to_parents IS 'Si es TRUE, los padres pueden ver este período en su portal';

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_billing_periods_school ON billing_periods(school_id);
CREATE INDEX IF NOT EXISTS idx_billing_periods_status ON billing_periods(status);
CREATE INDEX IF NOT EXISTS idx_billing_periods_dates ON billing_periods(start_date, end_date);

-- =====================================================
-- 3. CREAR TABLA billing_payments (Pagos de Cobranza)
-- =====================================================

CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES parent_profiles(user_id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  billing_period_id UUID REFERENCES billing_periods(id) ON DELETE SET NULL,
  
  -- Montos
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  pending_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  
  -- Datos del pago
  payment_method TEXT CHECK (payment_method IN ('efectivo', 'transferencia', 'yape', 'plin', 'tarjeta', 'otro')),
  operation_number TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  
  -- Documento
  document_type TEXT DEFAULT 'ticket' CHECK (document_type IN ('ticket', 'boleta', 'factura')),
  document_number TEXT,
  
  -- Estado y transacciones
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'completed', 'cancelled')),
  transaction_ids JSONB DEFAULT '[]'::jsonb,
  
  -- Observaciones
  notes TEXT,
  
  -- Auditoría
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT valid_amounts CHECK (paid_amount <= total_amount)
);

COMMENT ON TABLE billing_payments IS 'Registro de pagos de cobranzas realizados por padres';
COMMENT ON COLUMN billing_payments.transaction_ids IS 'Array de IDs de transactions incluidas en este pago (formato JSON)';
COMMENT ON COLUMN billing_payments.status IS 'pending: no pagado, partial: pago parcial, completed: pagado completo, cancelled: anulado';

-- Índices
CREATE INDEX IF NOT EXISTS idx_billing_payments_parent ON billing_payments(parent_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_student ON billing_payments(student_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_school ON billing_payments(school_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_period ON billing_payments(billing_period_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status ON billing_payments(status);
CREATE INDEX IF NOT EXISTS idx_billing_payments_paid_at ON billing_payments(paid_at);

-- =====================================================
-- 4. CREAR TABLA billing_messages (Mensajes de Cobranza)
-- =====================================================

CREATE TABLE IF NOT EXISTS billing_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  billing_period_id UUID REFERENCES billing_periods(id) ON DELETE SET NULL,
  
  -- Destinatario
  parent_id UUID NOT NULL REFERENCES parent_profiles(user_id) ON DELETE CASCADE,
  parent_phone TEXT NOT NULL,
  student_name TEXT NOT NULL,
  
  -- Mensaje
  message_text TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  pdf_url TEXT,
  
  -- Estado de envío
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'cancelled')),
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  
  -- Intervalo de envío (para n8n)
  scheduled_delay_seconds INTEGER, -- Delay aleatorio asignado
  
  -- Auditoría
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE billing_messages IS 'Cola de mensajes de cobranza para enviar por WhatsApp';
COMMENT ON COLUMN billing_messages.scheduled_delay_seconds IS 'Segundos de delay antes de enviar (15-300 seg aleatorio)';

-- Índices
CREATE INDEX IF NOT EXISTS idx_billing_messages_status ON billing_messages(status);
CREATE INDEX IF NOT EXISTS idx_billing_messages_parent ON billing_messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_billing_messages_school ON billing_messages(school_id);
CREATE INDEX IF NOT EXISTS idx_billing_messages_period ON billing_messages(billing_period_id);

-- =====================================================
-- 5. CREAR TABLA billing_config (Configuración)
-- =====================================================

CREATE TABLE IF NOT EXISTS billing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  
  -- Plantilla de mensaje
  message_template TEXT NOT NULL DEFAULT '🔔 *COBRANZA LIMA CAFÉ 28*

Estimado(a) {nombre_padre}

El alumno *{nombre_estudiante}* tiene un consumo pendiente del período: {periodo}

💰 Monto Total: S/ {monto}

📎 Adjuntamos el detalle completo.

Para pagar, contacte con administración.
Gracias.',
  
  -- Datos bancarios para incluir en PDF
  bank_account_info TEXT,
  yape_number TEXT,
  plin_number TEXT,
  
  -- Configuración de envíos
  enable_auto_reminders BOOLEAN DEFAULT FALSE,
  reminder_days_before INTEGER DEFAULT 3,
  
  -- Auditoría
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(school_id)
);

COMMENT ON TABLE billing_config IS 'Configuración de cobranzas por sede';

-- =====================================================
-- 6. ACTUALIZAR TABLA transactions
-- =====================================================
-- Agregar campos para control de pagos

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS is_billed BOOLEAN DEFAULT FALSE;

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS billing_payment_id UUID REFERENCES billing_payments(id) ON DELETE SET NULL;

COMMENT ON COLUMN transactions.is_billed IS 'Indica si esta transacción ya fue incluida en un pago de cobranza';
COMMENT ON COLUMN transactions.billing_payment_id IS 'ID del pago de cobranza al que pertenece esta transacción';

CREATE INDEX IF NOT EXISTS idx_transactions_is_billed ON transactions(is_billed);
CREATE INDEX IF NOT EXISTS idx_transactions_billing_payment ON transactions(billing_payment_id);

-- =====================================================
-- 7. FUNCIÓN PARA CALCULAR PENDING_AMOUNT AUTOMÁTICO
-- =====================================================

CREATE OR REPLACE FUNCTION update_billing_payment_pending()
RETURNS TRIGGER AS $$
BEGIN
  NEW.pending_amount := NEW.total_amount - NEW.paid_amount;
  
  -- Actualizar estado según el pago
  IF NEW.paid_amount = 0 THEN
    NEW.status := 'pending';
  ELSIF NEW.paid_amount < NEW.total_amount THEN
    NEW.status := 'partial';
  ELSE
    NEW.status := 'completed';
  END IF;
  
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger
DROP TRIGGER IF EXISTS trigger_update_billing_payment_pending ON billing_payments;
CREATE TRIGGER trigger_update_billing_payment_pending
  BEFORE INSERT OR UPDATE OF total_amount, paid_amount
  ON billing_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_billing_payment_pending();

-- =====================================================
-- 8. INSERTAR CONFIGURACIÓN INICIAL
-- =====================================================

-- Insertar config por defecto para todas las sedes existentes
INSERT INTO billing_config (school_id, message_template)
SELECT id, DEFAULT
FROM schools
ON CONFLICT (school_id) DO NOTHING;

-- =====================================================
-- 9. PERMISOS PARA EL MÓDULO DE COBRANZAS
-- =====================================================

-- Insertar permisos
INSERT INTO permissions (module, action, name, description) VALUES
  ('cobranzas', 'Ver Dashboard', 'cobranzas.ver_dashboard', 'Ver estadísticas y resumen de cobranzas'),
  ('cobranzas', 'Crear Períodos', 'cobranzas.crear_periodos', 'Crear nuevos períodos de cobranza'),
  ('cobranzas', 'Editar Períodos', 'cobranzas.editar_periodos', 'Modificar períodos de cobranza'),
  ('cobranzas', 'Cerrar Períodos', 'cobranzas.cerrar_periodos', 'Cerrar períodos de cobranza'),
  ('cobranzas', 'Registrar Pagos', 'cobranzas.registrar_pagos', 'Registrar pagos de padres'),
  ('cobranzas', 'Enviar Mensajes', 'cobranzas.enviar_mensajes', 'Enviar mensajes masivos de cobranza'),
  ('cobranzas', 'Generar PDFs', 'cobranzas.generar_pdfs', 'Generar PDFs de estado de cuenta'),
  ('cobranzas', 'Ver Reportes', 'cobranzas.ver_reportes', 'Ver reportes históricos de cobranza'),
  ('cobranzas', 'Configurar', 'cobranzas.configurar', 'Configurar plantillas y datos de pago'),
  ('cobranzas', 'Ver Todas las Sedes', 'cobranzas.ver_todas_sedes', 'Ver cobranzas de todas las sedes')
ON CONFLICT (module, action) DO NOTHING;

-- Otorgar permisos por defecto a Admin General
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 
  'admin_general',
  id,
  true
FROM permissions
WHERE module = 'cobranzas'
ON CONFLICT (role, permission_id) DO UPDATE SET granted = EXCLUDED.granted;

-- Otorgar permisos limitados a Gestor de Unidad (excepto ver todas las sedes)
INSERT INTO role_permissions (role, permission_id, granted)
SELECT 
  'gestor_unidad',
  id,
  true
FROM permissions
WHERE module = 'cobranzas' 
AND name != 'cobranzas.ver_todas_sedes'
AND name != 'cobranzas.configurar'
ON CONFLICT (role, permission_id) DO UPDATE SET granted = EXCLUDED.granted;

-- =====================================================
-- 10. VERIFICACIÓN FINAL
-- =====================================================

SELECT 
  '✅ Tablas creadas correctamente' as status,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('billing_periods', 'billing_payments', 'billing_messages', 'billing_config')) as tablas_creadas,
  (SELECT COUNT(*) FROM permissions WHERE module = 'cobranzas') as permisos_creados;

-- Mostrar estructura de parent_profiles actualizada
SELECT 
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'parent_profiles'
AND column_name IN ('account_type', 'daily_limit', 'current_balance')
ORDER BY ordinal_position;

-- Listar todas las nuevas tablas
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as num_columns
FROM information_schema.tables t
WHERE table_name IN ('billing_periods', 'billing_payments', 'billing_messages', 'billing_config')
ORDER BY table_name;

