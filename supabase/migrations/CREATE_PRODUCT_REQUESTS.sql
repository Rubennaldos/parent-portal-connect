-- Tabla de solicitudes de cambio de productos
-- Los admins por sede (gestor_unidad) escriben aquí sus pedidos
-- El admin general los revisa y toma acción

CREATE TABLE IF NOT EXISTS product_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  school_name TEXT,
  request_type TEXT NOT NULL CHECK (request_type IN ('cambio_precio', 'cambio_stock', 'nuevo_producto', 'dar_de_baja', 'otro')),
  product_name TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_revision', 'aprobado', 'rechazado')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_product_requests_school_id ON product_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_product_requests_status ON product_requests(status);
CREATE INDEX IF NOT EXISTS idx_product_requests_user_id ON product_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_product_requests_created_at ON product_requests(created_at DESC);

-- RLS: activar seguridad por fila
ALTER TABLE product_requests ENABLE ROW LEVEL SECURITY;

-- Política: el gestor de una sede solo ve las solicitudes de su sede
CREATE POLICY "gestor_unidad_ver_sus_solicitudes" ON product_requests
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin')
    )
  );

-- Política: el gestor puede crear solicitudes
CREATE POLICY "gestor_unidad_crear_solicitud" ON product_requests
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
  );

-- Política: solo admin_general puede actualizar (aprobar/rechazar)
CREATE POLICY "admin_general_actualizar_solicitud" ON product_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin')
    )
  );

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_product_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_product_requests_updated_at
  BEFORE UPDATE ON product_requests
  FOR EACH ROW EXECUTE FUNCTION update_product_requests_updated_at();
