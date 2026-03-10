-- ============================================
-- TABLA: dev_backlog
-- Tickets generados por el Agente de Soporte IA
-- ============================================

CREATE TABLE IF NOT EXISTS dev_backlog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Quién reportó
  reporter_id UUID REFERENCES auth.users(id),
  reporter_email TEXT,
  reporter_role TEXT,
  reporter_school_id UUID,
  reporter_school_name TEXT,
  
  -- Contexto automático
  page_url TEXT,
  console_errors JSONB DEFAULT '[]'::jsonb,
  
  -- Descripción del problema
  user_message TEXT NOT NULL,
  screenshot_url TEXT,  -- URL pública del archivo en Supabase Storage
  
  -- Análisis de la IA
  ai_classification TEXT CHECK (ai_classification IN ('user_error', 'system_error', 'ui_bug', 'feature_request', 'unknown')),
  ai_response TEXT,              -- Respuesta que vio el usuario
  ai_technical_analysis TEXT,    -- Análisis técnico interno
  cursor_fix_prompt TEXT,        -- 🔧 Comando exacto para pegar en Cursor
  
  -- Estado
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'fixed', 'wont_fix', 'duplicate')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id)
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_dev_backlog_status ON dev_backlog(status);
CREATE INDEX IF NOT EXISTS idx_dev_backlog_priority ON dev_backlog(priority);
CREATE INDEX IF NOT EXISTS idx_dev_backlog_created ON dev_backlog(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_backlog_classification ON dev_backlog(ai_classification);
CREATE INDEX IF NOT EXISTS idx_dev_backlog_school ON dev_backlog(reporter_school_id);
CREATE INDEX IF NOT EXISTS idx_dev_backlog_reporter ON dev_backlog(reporter_id);

-- RLS
ALTER TABLE dev_backlog ENABLE ROW LEVEL SECURITY;

-- 1) SuperAdmin y Admin General: acceso total (CRUD)
CREATE POLICY "superadmin_full_access" ON dev_backlog
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('superadmin', 'admin_general')
    )
  );

-- 2) Cualquier usuario autenticado puede insertar sus propios tickets
CREATE POLICY "authenticated_insert" ON dev_backlog
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- 3) FIX H2: Los usuarios pueden VER sus propios tickets (para saber el estado)
CREATE POLICY "users_read_own_tickets" ON dev_backlog
  FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_dev_backlog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_dev_backlog_updated_at
  BEFORE UPDATE ON dev_backlog
  FOR EACH ROW
  EXECUTE FUNCTION update_dev_backlog_updated_at();

-- ============================================
-- BUCKET: support-attachments
-- Para subir capturas/videos del widget de soporte
-- ============================================
-- NOTA: Ejecutar esto en el SQL Editor de Supabase:

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  true,
  10485760,  -- 10MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

-- Política: cualquier usuario autenticado puede subir a su carpeta
CREATE POLICY "users_upload_support_files" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'support-attachments');

-- Política: lectura pública (para que el superadmin vea las capturas)
CREATE POLICY "public_read_support_files" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'support-attachments');

-- Verificar
SELECT 'Tabla dev_backlog + Storage bucket creados exitosamente' AS resultado;
