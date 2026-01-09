-- =========================================
-- SISTEMA COMPLETO DE LOGGING DE ERRORES
-- =========================================

-- 1. Crear tabla de error_logs (si no existe)
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_role TEXT,
  
  -- Información del error
  error_type TEXT NOT NULL, -- 'auth', 'database', 'validation', 'network', 'permission', 'unknown'
  error_message TEXT NOT NULL, -- Mensaje técnico original
  error_translated TEXT, -- Mensaje traducido/amigable
  error_stack TEXT, -- Stack trace (opcional)
  
  -- Contexto
  page_url TEXT,
  component TEXT,
  action TEXT, -- Qué estaba haciendo (ej: 'fetching_students', 'creating_user')
  
  -- Metadata
  browser_info JSONB,
  device_info JSONB,
  
  -- Estado
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_type ON error_logs(error_type);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(is_resolved);
CREATE INDEX IF NOT EXISTS idx_error_logs_page ON error_logs(page_url);

-- 2. RLS Policies
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- SuperAdmin y Admin General pueden ver todos los errores
DROP POLICY IF EXISTS "Admins can view all error logs" ON error_logs;
CREATE POLICY "Admins can view all error logs"
  ON error_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('superadmin', 'admin_general')
    )
  );

-- Solo SuperAdmin puede marcar como resuelto
DROP POLICY IF EXISTS "SuperAdmin can update error logs" ON error_logs;
CREATE POLICY "SuperAdmin can update error logs"
  ON error_logs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );

-- Cualquier usuario autenticado puede insertar errores
DROP POLICY IF EXISTS "Authenticated users can insert errors" ON error_logs;
CREATE POLICY "Authenticated users can insert errors"
  ON error_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Vista: Estadísticas de Errores
DROP VIEW IF EXISTS error_statistics CASCADE;
CREATE VIEW error_statistics AS
SELECT 
  error_type,
  COUNT(*) as total_count,
  COUNT(DISTINCT user_id) as affected_users,
  MAX(created_at) as last_occurrence,
  EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/3600 as hours_since_last,
  AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/3600) as avg_hours_ago
FROM error_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY error_type
ORDER BY total_count DESC;

-- 4. Vista: Puntos Críticos (Hotspots)
DROP VIEW IF EXISTS error_hotspots CASCADE;
CREATE VIEW error_hotspots AS
SELECT 
  page_url,
  component,
  COUNT(*) as error_count,
  COUNT(DISTINCT user_id) as affected_users,
  ARRAY_AGG(DISTINCT error_type) as error_types,
  MAX(created_at) as last_occurrence
FROM error_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY page_url, component
HAVING COUNT(*) >= 3
ORDER BY error_count DESC
LIMIT 10;

-- 5. Vista: Errores Más Frecuentes
DROP VIEW IF EXISTS most_frequent_errors CASCADE;
CREATE VIEW most_frequent_errors AS
SELECT 
  error_message,
  error_translated,
  COUNT(*) as occurrences,
  COUNT(DISTINCT user_id) as affected_users,
  MAX(created_at) as last_seen,
  page_url,
  component
FROM error_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY error_message, error_translated, page_url, component
ORDER BY occurrences DESC
LIMIT 10;

-- 6. Función para limpiar errores antiguos (ejecutar mensualmente)
CREATE OR REPLACE FUNCTION cleanup_old_errors()
RETURNS void AS $$
BEGIN
  -- Eliminar errores resueltos de hace más de 90 días
  DELETE FROM error_logs
  WHERE is_resolved = true
    AND resolved_at < NOW() - INTERVAL '90 days';
  
  -- Eliminar errores no resueltos de hace más de 180 días
  DELETE FROM error_logs
  WHERE is_resolved = false
    AND created_at < NOW() - INTERVAL '180 days';
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- VERIFICACIÓN
-- =========================================

-- Ver si la tabla existe y tiene datos
SELECT 
  COUNT(*) as total_errores,
  COUNT(DISTINCT user_id) as usuarios_afectados,
  COUNT(*) FILTER (WHERE is_resolved = true) as resueltos,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as ultimas_24h
FROM error_logs;

-- Ver últimos 10 errores
SELECT 
  created_at,
  user_email,
  error_type,
  error_translated,
  page_url,
  is_resolved
FROM error_logs
ORDER BY created_at DESC
LIMIT 10;

-- =========================================
-- GRANT PERMISSIONS
-- =========================================

-- Asegurar que las vistas sean accesibles
GRANT SELECT ON error_statistics TO authenticated;
GRANT SELECT ON error_hotspots TO authenticated;
GRANT SELECT ON most_frequent_errors TO authenticated;

