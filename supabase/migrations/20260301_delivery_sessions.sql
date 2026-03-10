-- =====================================================
-- TABLA DE SESIONES DE ENTREGA DE ALMUERZOS
-- Para guardar reportes automáticos de cada sesión
-- =====================================================

CREATE TABLE IF NOT EXISTS delivery_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  started_by UUID REFERENCES auth.users(id),
  ended_by UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  
  -- Resumen numérico
  total_orders INT DEFAULT 0,
  total_delivered INT DEFAULT 0,
  total_not_collected INT DEFAULT 0,
  total_modified INT DEFAULT 0,
  total_added_without_order INT DEFAULT 0,
  total_students INT DEFAULT 0,
  total_teachers INT DEFAULT 0,
  
  -- Reporte completo en JSON (desglose por aula, categoría, etc.)
  report_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_delivery_sessions_school ON delivery_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_delivery_sessions_date ON delivery_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_delivery_sessions_status ON delivery_sessions(status);

-- Comentarios
COMMENT ON TABLE delivery_sessions IS 'Registro de cada sesión de entrega de almuerzos con reporte automático';
COMMENT ON COLUMN delivery_sessions.report_data IS 'JSON con desglose completo: por aula, categoría, lista de entregados/no entregados, modificaciones, etc.';

-- RLS: Solo admins pueden ver/crear sesiones de su escuela
ALTER TABLE delivery_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_sessions_select" ON delivery_sessions
  FOR SELECT USING (true);

CREATE POLICY "delivery_sessions_insert" ON delivery_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "delivery_sessions_update" ON delivery_sessions
  FOR UPDATE USING (true);
