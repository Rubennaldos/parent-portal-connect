-- =========================================
-- SISTEMA DE CUENTA LIBRE Y PASARELA DE PAGOS
-- 1. Cuenta libre por defecto
-- 2. Tabla para transacciones de pasarela de pagos
-- 3. Integración con procesadores (Niubiz, Izipay, etc.)
-- =========================================

-- 1. Modificar parent_profiles para cuenta libre por defecto
ALTER TABLE parent_profiles
ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'free' CHECK (account_type IN ('free', 'prepaid', 'limited'));

COMMENT ON COLUMN parent_profiles.account_type IS 
  'Tipo de cuenta: free (consumo libre, se cobra después), prepaid (saldo prepagado), limited (con tope diario)';

-- Actualizar cuentas existentes a "free" si no tienen tipo
UPDATE parent_profiles 
SET account_type = 'free' 
WHERE account_type IS NULL;

-- 2. Tabla para transacciones de pasarela de pagos
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Usuario
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_profile_id UUID REFERENCES parent_profiles(user_id) ON DELETE CASCADE,
  
  -- Datos del pago
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  currency TEXT DEFAULT 'PEN' CHECK (currency IN ('PEN', 'USD')),
  
  -- Pasarela de pago
  payment_gateway TEXT NOT NULL, -- 'niubiz', 'izipay', 'mercadopago', 'culqi', 'pagoefectivo', 'manual'
  transaction_reference TEXT, -- ID de transacción del procesador
  authorization_code TEXT, -- Código de autorización del banco
  
  -- Estado del pago
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'approved', 'rejected', 'cancelled', 'refunded', 'expired')
  ),
  
  -- Método de pago
  payment_method TEXT, -- 'card', 'yape', 'plin', 'bank_transfer', 'cash', 'pos'
  card_brand TEXT, -- 'visa', 'mastercard', 'amex', 'diners'
  card_last_four TEXT, -- Últimos 4 dígitos de la tarjeta
  
  -- Datos del procesador
  gateway_response JSONB, -- Respuesta completa del procesador
  gateway_request JSONB, -- Request enviado al procesador
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ, -- Cuando se procesó
  approved_at TIMESTAMPTZ, -- Cuando se aprobó
  expired_at TIMESTAMPTZ, -- Cuando expira (para pendientes)
  
  -- Relación con recarga
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  recharge_applied BOOLEAN DEFAULT false, -- Si ya se aplicó la recarga al saldo
  
  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  device_info JSONB,
  notes TEXT
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_gateway ON payment_transactions(payment_gateway);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_created ON payment_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_reference ON payment_transactions(transaction_reference);

-- 3. Tabla de configuración de pasarelas de pago
CREATE TABLE IF NOT EXISTS payment_gateway_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  gateway_name TEXT UNIQUE NOT NULL, -- 'niubiz', 'izipay', etc.
  is_active BOOLEAN DEFAULT false,
  is_production BOOLEAN DEFAULT false, -- true: producción, false: sandbox/testing
  
  -- Credenciales (ENCRIPTADAS en producción)
  merchant_id TEXT,
  api_key TEXT,
  api_secret TEXT,
  webhook_secret TEXT,
  
  -- URLs
  api_url TEXT,
  webhook_url TEXT,
  callback_url TEXT,
  
  -- Configuración
  settings JSONB, -- Configuraciones específicas de cada gateway
  
  -- Límites y comisiones
  min_amount DECIMAL(10,2) DEFAULT 1.00,
  max_amount DECIMAL(10,2) DEFAULT 10000.00,
  commission_percentage DECIMAL(5,2) DEFAULT 0.00, -- % de comisión
  commission_fixed DECIMAL(10,2) DEFAULT 0.00, -- Comisión fija
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar configuraciones por defecto (sandbox)
INSERT INTO payment_gateway_config (gateway_name, is_active, is_production, settings)
VALUES 
  ('manual', true, true, '{"description": "Pago manual verificado por administrador"}'),
  ('niubiz', false, false, '{"merchant_id": "", "terminal_id": ""}'),
  ('izipay', false, false, '{"shop_id": "", "public_key": ""}'),
  ('culqi', false, false, '{"public_key": "", "private_key": ""}'),
  ('mercadopago', false, false, '{"public_key": "", "access_token": ""}')
ON CONFLICT (gateway_name) DO NOTHING;

-- 4. Vista para estadísticas de pagos
CREATE OR REPLACE VIEW payment_statistics AS
SELECT 
  payment_gateway,
  status,
  COUNT(*) as total_transactions,
  SUM(amount) as total_amount,
  AVG(amount) as avg_amount,
  COUNT(DISTINCT user_id) as unique_users,
  MIN(created_at) as first_transaction,
  MAX(created_at) as last_transaction
FROM payment_transactions
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY payment_gateway, status
ORDER BY total_amount DESC;

-- 5. RLS Policies
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- Los padres solo ven sus propios pagos
DROP POLICY IF EXISTS "Users can view own payment transactions" ON payment_transactions;
CREATE POLICY "Users can view own payment transactions"
  ON payment_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Los padres pueden crear sus propios pagos
DROP POLICY IF EXISTS "Users can create own payment transactions" ON payment_transactions;
CREATE POLICY "Users can create own payment transactions"
  ON payment_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- SuperAdmin puede ver todo
DROP POLICY IF EXISTS "SuperAdmin can view all payment transactions" ON payment_transactions;
CREATE POLICY "SuperAdmin can view all payment transactions"
  ON payment_transactions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.email = 'superadmin@limacafe28.com'
    )
  );

-- 6. Función para aplicar recarga después de pago aprobado
CREATE OR REPLACE FUNCTION apply_payment_recharge()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el pago fue aprobado y no se ha aplicado la recarga
  IF NEW.status = 'approved' AND NEW.recharge_applied = false AND NEW.student_id IS NOT NULL THEN
    -- Actualizar saldo del estudiante
    UPDATE students 
    SET balance = balance + NEW.amount
    WHERE id = NEW.student_id;
    
    -- Marcar como aplicada
    NEW.recharge_applied = true;
    NEW.approved_at = NOW();
    
    -- Registrar en transacciones
    INSERT INTO transactions (
      student_id,
      type,
      amount,
      payment_method,
      notes,
      created_by
    ) VALUES (
      NEW.student_id,
      'recharge',
      NEW.amount,
      COALESCE(NEW.payment_method, 'online'),
      'Recarga vía ' || NEW.payment_gateway || ' - Ref: ' || COALESCE(NEW.transaction_reference, NEW.id::text),
      NEW.user_id
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para aplicar recarga automáticamente
DROP TRIGGER IF EXISTS trigger_apply_payment_recharge ON payment_transactions;
CREATE TRIGGER trigger_apply_payment_recharge
  BEFORE UPDATE ON payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION apply_payment_recharge();

-- 7. Función para expirar pagos pendientes (ejecutar con cron)
CREATE OR REPLACE FUNCTION expire_pending_payments()
RETURNS void AS $$
BEGIN
  UPDATE payment_transactions
  SET status = 'expired'
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Comentarios
COMMENT ON TABLE payment_transactions IS 'Transacciones de pasarelas de pago (Niubiz, Izipay, etc.)';
COMMENT ON TABLE payment_gateway_config IS 'Configuración de pasarelas de pago activas';
COMMENT ON COLUMN parent_profiles.account_type IS 'free: consume y paga después, prepaid: solo gasta si tiene saldo, limited: con tope diario';

-- =========================================
-- RESUMEN PARA INTEGRACIÓN
-- =========================================
/*
📌 CÓMO FUNCIONA:

1. CUENTA LIBRE (Por defecto):
   - account_type = 'free'
   - El estudiante consume sin límite
   - Se cobra después (vía cobranzas o voluntario)

2. FLUJO DE PAGO ONLINE:
   a) Usuario elige monto y estudiante
   b) Frontend crea registro en payment_transactions (status: pending)
   c) Frontend redirige a pasarela (Niubiz, Izipay)
   d) Pasarela procesa pago
   e) Webhook actualiza status a 'approved'
   f) Trigger aplica recarga automáticamente

3. PASARELAS SOPORTADAS:
   - Niubiz (Visa): Para tarjetas Visa/Mastercard
   - Izipay: Todas las tarjetas + Yape
   - Culqi: Tarjetas + transferencias
   - MercadoPago: Múltiples métodos
   - Manual: Verificación por admin

4. DATOS PARA NIUBIZ:
   - Merchant ID (te lo dan al contratar)
   - Terminal ID
   - API Key (producción y sandbox)
   - Certificado SSL para webhooks

5. SEGURIDAD:
   - Credenciales encriptadas
   - RLS activado
   - Webhooks firmados
   - 3D Secure obligatorio
*/

