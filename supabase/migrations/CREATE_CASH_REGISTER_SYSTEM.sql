-- 💰 SISTEMA DE CIERRE DE CAJA
-- Tablas para gestionar apertura, movimientos (ingresos/egresos) y cierre de caja

-- ============================================
-- 1. TABLA: cash_registers (Registro de Cajas)
-- ============================================
CREATE TABLE IF NOT EXISTS cash_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES profiles(id),
  opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  initial_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  expected_amount DECIMAL(10,2) DEFAULT 0,
  actual_amount DECIMAL(10,2),
  difference DECIMAL(10,2), -- Diferencia entre esperado y real
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by UUID REFERENCES profiles(id),
  closed_at TIMESTAMP WITH TIME ZONE,
  admin_password_validated BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_cash_registers_school ON cash_registers(school_id);
CREATE INDEX idx_cash_registers_status ON cash_registers(status);
CREATE INDEX idx_cash_registers_opened_at ON cash_registers(opened_at);

-- ============================================
-- 2. TABLA: cash_movements (Ingresos y Egresos)
-- ============================================
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('ingreso', 'egreso', 'ajuste')),
  amount DECIMAL(10,2) NOT NULL,
  reason TEXT NOT NULL,
  responsible_name VARCHAR(255) NOT NULL,
  responsible_id UUID REFERENCES profiles(id),
  created_by UUID NOT NULL REFERENCES profiles(id),
  requires_signature BOOLEAN DEFAULT true,
  signature_validated BOOLEAN DEFAULT false,
  voucher_printed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_cash_movements_register ON cash_movements(cash_register_id);
CREATE INDEX idx_cash_movements_school ON cash_movements(school_id);
CREATE INDEX idx_cash_movements_type ON cash_movements(type);
CREATE INDEX idx_cash_movements_created_at ON cash_movements(created_at);

-- ============================================
-- 3. TABLA: cash_closures (Resumen de Cierres)
-- ============================================
CREATE TABLE IF NOT EXISTS cash_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  closure_date DATE NOT NULL,
  
  -- POS - Punto de Venta
  pos_cash DECIMAL(10,2) DEFAULT 0,
  pos_card DECIMAL(10,2) DEFAULT 0,
  pos_yape DECIMAL(10,2) DEFAULT 0,
  pos_yape_qr DECIMAL(10,2) DEFAULT 0,
  pos_credit DECIMAL(10,2) DEFAULT 0,
  pos_mixed_cash DECIMAL(10,2) DEFAULT 0, -- Parte en efectivo de pagos mixtos
  pos_mixed_card DECIMAL(10,2) DEFAULT 0, -- Parte en tarjeta de pagos mixtos
  pos_mixed_yape DECIMAL(10,2) DEFAULT 0, -- Parte en yape de pagos mixtos
  pos_total DECIMAL(10,2) DEFAULT 0,
  
  -- ALMUERZOS - Lunch Orders
  lunch_cash DECIMAL(10,2) DEFAULT 0,
  lunch_credit DECIMAL(10,2) DEFAULT 0,
  lunch_card DECIMAL(10,2) DEFAULT 0,
  lunch_yape DECIMAL(10,2) DEFAULT 0,
  lunch_total DECIMAL(10,2) DEFAULT 0,
  
  -- TOTALES GENERALES
  total_cash DECIMAL(10,2) DEFAULT 0,
  total_card DECIMAL(10,2) DEFAULT 0,
  total_yape DECIMAL(10,2) DEFAULT 0,
  total_yape_qr DECIMAL(10,2) DEFAULT 0,
  total_credit DECIMAL(10,2) DEFAULT 0,
  total_sales DECIMAL(10,2) DEFAULT 0,
  
  -- MOVIMIENTOS
  total_ingresos DECIMAL(10,2) DEFAULT 0,
  total_egresos DECIMAL(10,2) DEFAULT 0,
  
  -- CAJA
  initial_amount DECIMAL(10,2) DEFAULT 0,
  expected_final DECIMAL(10,2) DEFAULT 0,
  actual_final DECIMAL(10,2) DEFAULT 0,
  difference DECIMAL(10,2) DEFAULT 0,
  
  -- METADATOS
  closed_by UUID NOT NULL REFERENCES profiles(id),
  admin_validated_by UUID REFERENCES profiles(id),
  exported_to_excel BOOLEAN DEFAULT false,
  exported_to_pdf BOOLEAN DEFAULT false,
  sent_to_whatsapp BOOLEAN DEFAULT false,
  whatsapp_phone VARCHAR(20),
  printed BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_cash_closures_school ON cash_closures(school_id);
CREATE INDEX idx_cash_closures_date ON cash_closures(closure_date);
CREATE INDEX idx_cash_closures_register ON cash_closures(cash_register_id);

-- ============================================
-- 4. TABLA: cash_register_config
-- ============================================
CREATE TABLE IF NOT EXISTS cash_register_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE UNIQUE,
  auto_close_enabled BOOLEAN DEFAULT false,
  auto_close_time TIME DEFAULT '18:00:00',
  whatsapp_phone VARCHAR(20) DEFAULT '991236870',
  require_admin_password BOOLEAN DEFAULT true,
  alert_on_difference BOOLEAN DEFAULT true,
  difference_threshold DECIMAL(10,2) DEFAULT 10.00, -- Alerta si diferencia > 10 soles
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice
CREATE INDEX idx_cash_config_school ON cash_register_config(school_id);

-- ============================================
-- 5. RLS POLICIES
-- ============================================

-- cash_registers
ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin y operadores pueden ver cajas de su sede"
ON cash_registers FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'admin_general')
  )
);

CREATE POLICY "Admin y operadores pueden crear cajas"
ON cash_registers FOR INSERT
TO authenticated
WITH CHECK (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'admin_general', 'operador_caja')
  )
);

CREATE POLICY "Admin y operadores pueden actualizar cajas de su sede"
ON cash_registers FOR UPDATE
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
);

-- cash_movements
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver movimientos de su sede"
ON cash_movements FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Crear movimientos en su sede"
ON cash_movements FOR INSERT
TO authenticated
WITH CHECK (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
);

-- cash_closures
ALTER TABLE cash_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver cierres de su sede"
ON cash_closures FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Crear cierres en su sede"
ON cash_closures FOR INSERT
TO authenticated
WITH CHECK (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
);

-- cash_register_config
ALTER TABLE cash_register_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver config de su sede"
ON cash_register_config FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Admin puede actualizar config"
ON cash_register_config FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'admin_general')
    AND school_id = cash_register_config.school_id
  )
);

-- ============================================
-- 6. TRIGGERS
-- ============================================

-- Actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cash_registers_updated_at
BEFORE UPDATE ON cash_registers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cash_config_updated_at
BEFORE UPDATE ON cash_register_config
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. FUNCIÓN: Calcular totales del día
-- ============================================
CREATE OR REPLACE FUNCTION calculate_daily_totals(p_school_id UUID, p_date DATE)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'pos', (
      SELECT json_build_object(
        'cash', COALESCE(SUM(CASE WHEN payment_method = 'efectivo' AND paid_with_mixed = false THEN total_amount ELSE 0 END), 0),
        'card', COALESCE(SUM(CASE WHEN payment_method = 'tarjeta' AND paid_with_mixed = false THEN total_amount ELSE 0 END), 0),
        'yape', COALESCE(SUM(CASE WHEN payment_method = 'yape' AND paid_with_mixed = false THEN total_amount ELSE 0 END), 0),
        'yape_qr', COALESCE(SUM(CASE WHEN payment_method = 'yape_qr' AND paid_with_mixed = false THEN total_amount ELSE 0 END), 0),
        'credit', COALESCE(SUM(CASE WHEN payment_status = 'credito' THEN total_amount ELSE 0 END), 0),
        'mixed_cash', COALESCE(SUM(CASE WHEN paid_with_mixed = true THEN cash_amount ELSE 0 END), 0),
        'mixed_card', COALESCE(SUM(CASE WHEN paid_with_mixed = true THEN card_amount ELSE 0 END), 0),
        'mixed_yape', COALESCE(SUM(CASE WHEN paid_with_mixed = true THEN yape_amount ELSE 0 END), 0),
        'total', COALESCE(SUM(total_amount), 0)
      )
      FROM transactions
      WHERE school_id = p_school_id
        AND DATE(created_at) = p_date
    ),
    'lunch', (
      SELECT json_build_object(
        'cash', COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN amount ELSE 0 END), 0),
        'card', COALESCE(SUM(CASE WHEN payment_method = 'tarjeta' THEN amount ELSE 0 END), 0),
        'yape', COALESCE(SUM(CASE WHEN payment_method = 'yape' THEN amount ELSE 0 END), 0),
        'credit', COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END), 0),
        'total', COALESCE(SUM(amount), 0)
      )
      FROM lunch_transactions
      WHERE school_id = p_school_id
        AND DATE(transaction_date) = p_date
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE cash_registers IS 'Registro de apertura y cierre de caja por sede';
COMMENT ON TABLE cash_movements IS 'Ingresos, egresos y ajustes de caja durante el día';
COMMENT ON TABLE cash_closures IS 'Resumen detallado de cada cierre de caja';
COMMENT ON TABLE cash_register_config IS 'Configuración del sistema de caja por sede';
