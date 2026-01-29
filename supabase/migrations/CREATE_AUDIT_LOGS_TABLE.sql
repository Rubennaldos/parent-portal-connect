-- =====================================================
-- TABLA DE AUDITORÍA PARA ACCIONES DE ADMINISTRADOR
-- =====================================================
-- Esta tabla es OPCIONAL pero recomendada para tener
-- un registro de todas las acciones sensibles del admin

-- Crear la tabla audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  admin_user_id UUID REFERENCES auth.users(id),
  target_user_email VARCHAR(255),
  target_user_id UUID,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_user_id ON public.audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id ON public.audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);

-- Comentarios
COMMENT ON TABLE public.audit_logs IS 'Registro de auditoría de acciones administrativas';
COMMENT ON COLUMN public.audit_logs.action IS 'Tipo de acción realizada (ej: reset_password, delete_user, etc)';
COMMENT ON COLUMN public.audit_logs.admin_user_id IS 'ID del administrador que realizó la acción';
COMMENT ON COLUMN public.audit_logs.target_user_email IS 'Email del usuario afectado';
COMMENT ON COLUMN public.audit_logs.target_user_id IS 'ID del usuario afectado';
COMMENT ON COLUMN public.audit_logs.details IS 'Detalles adicionales de la acción';

-- RLS (Row Level Security)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Política: Solo superadmins y admin_general pueden ver los logs
CREATE POLICY "Only admins can view audit logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('superadmin', 'admin_general')
    )
  );

-- Política: La Edge Function puede insertar logs (usando service_role)
CREATE POLICY "Service role can insert audit logs"
  ON public.audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Nota: No permitimos UPDATE ni DELETE de logs de auditoría
-- Los logs deben ser inmutables

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT INSERT ON public.audit_logs TO service_role;

-- =====================================================
-- VISTA PARA CONSULTAR LOGS CON INFORMACIÓN COMPLETA
-- =====================================================

CREATE OR REPLACE VIEW public.audit_logs_with_details AS
SELECT 
  al.id,
  al.action,
  al.timestamp,
  al.details,
  -- Info del admin que realizó la acción
  p_admin.full_name as admin_name,
  p_admin.email as admin_email,
  p_admin.role as admin_role,
  -- Info del usuario afectado
  al.target_user_email,
  al.target_user_id
FROM public.audit_logs al
LEFT JOIN public.profiles p_admin ON al.admin_user_id = p_admin.id
ORDER BY al.timestamp DESC;

-- RLS para la vista
ALTER VIEW public.audit_logs_with_details SET (security_invoker = true);

GRANT SELECT ON public.audit_logs_with_details TO authenticated;

-- =====================================================
-- FUNCIÓN PARA LIMPIAR LOGS ANTIGUOS (OPCIONAL)
-- =====================================================
-- Ejecutar mensualmente para mantener solo logs de los últimos 6 meses

CREATE OR REPLACE FUNCTION clean_old_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.audit_logs
  WHERE timestamp < NOW() - INTERVAL '6 months';
END;
$$;

-- =====================================================
-- ✅ TABLA CREADA EXITOSAMENTE
-- =====================================================
-- Ahora la Edge Function podrá registrar todas las
-- acciones de reseteo de contraseñas automáticamente
