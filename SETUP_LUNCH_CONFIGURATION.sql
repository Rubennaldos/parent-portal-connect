-- ============================================================================
-- CONFIGURACIÓN DE ALMUERZOS POR SEDE
-- ============================================================================
-- Este script crea la tabla de configuración para gestionar:
-- - Precio del almuerzo
-- - Límites de tiempo para hacer pedidos
-- - Límites de tiempo para cancelar pedidos
-- ============================================================================

-- Crear tabla de configuración de almuerzos
CREATE TABLE IF NOT EXISTS public.lunch_configuration (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  
  -- Precio del almuerzo
  lunch_price DECIMAL(10, 2) NOT NULL DEFAULT 7.50,
  
  -- Límites para hacer pedidos
  -- Ej: order_deadline_time = '20:00' y order_deadline_days = 1
  -- significa que se puede pedir hasta las 8pm del día anterior
  order_deadline_time TIME NOT NULL DEFAULT '20:00:00',
  order_deadline_days INTEGER NOT NULL DEFAULT 1,
  
  -- Límites para cancelar pedidos
  -- Ej: cancellation_deadline_time = '07:00' y cancellation_deadline_days = 0
  -- significa que se puede cancelar hasta las 7am del mismo día
  cancellation_deadline_time TIME NOT NULL DEFAULT '07:00:00',
  cancellation_deadline_days INTEGER NOT NULL DEFAULT 0,
  
  -- Habilitar/deshabilitar sistema de pedidos
  orders_enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadatos
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Un solo registro de configuración por sede
  UNIQUE(school_id)
);

-- Crear índice
CREATE INDEX IF NOT EXISTS idx_lunch_config_school ON public.lunch_configuration(school_id);

-- Crear trigger para updated_at
CREATE OR REPLACE FUNCTION update_lunch_configuration_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lunch_configuration_updated_at ON public.lunch_configuration;
CREATE TRIGGER trigger_update_lunch_configuration_updated_at
  BEFORE UPDATE ON public.lunch_configuration
  FOR EACH ROW
  EXECUTE FUNCTION update_lunch_configuration_updated_at();

-- ============================================================================
-- RLS (Row Level Security)
-- ============================================================================

ALTER TABLE public.lunch_configuration ENABLE ROW LEVEL SECURITY;

-- Policy: Admin General y Supervisor Red pueden ver todas las configuraciones
DROP POLICY IF EXISTS "Admin can view all lunch configurations" ON public.lunch_configuration;
CREATE POLICY "Admin can view all lunch configurations"
  ON public.lunch_configuration
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red')
    )
  );

-- Policy: Admin Sede puede ver solo su configuración
DROP POLICY IF EXISTS "School admin can view their lunch configuration" ON public.lunch_configuration;
CREATE POLICY "School admin can view their lunch configuration"
  ON public.lunch_configuration
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_sede'
      AND profiles.school_id = lunch_configuration.school_id
    )
  );

-- Policy: Padres pueden ver la configuración de la sede de sus hijos
DROP POLICY IF EXISTS "Parents can view lunch configuration of their children's school" ON public.lunch_configuration;
CREATE POLICY "Parents can view lunch configuration of their children's school"
  ON public.lunch_configuration
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.parent_id = auth.uid()
      AND students.school_id = lunch_configuration.school_id
      AND students.is_active = true
    )
  );

-- Policy: Admin General y Supervisor Red pueden insertar configuraciones
DROP POLICY IF EXISTS "Admin can insert lunch configurations" ON public.lunch_configuration;
CREATE POLICY "Admin can insert lunch configurations"
  ON public.lunch_configuration
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red')
    )
  );

-- Policy: Admin Sede puede insertar solo para su sede
DROP POLICY IF EXISTS "School admin can insert their lunch configuration" ON public.lunch_configuration;
CREATE POLICY "School admin can insert their lunch configuration"
  ON public.lunch_configuration
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_sede'
      AND profiles.school_id = lunch_configuration.school_id
    )
  );

-- Policy: Admin General y Supervisor Red pueden actualizar todas las configuraciones
DROP POLICY IF EXISTS "Admin can update all lunch configurations" ON public.lunch_configuration;
CREATE POLICY "Admin can update all lunch configurations"
  ON public.lunch_configuration
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'supervisor_red')
    )
  );

-- Policy: Admin Sede puede actualizar solo su configuración
DROP POLICY IF EXISTS "School admin can update their lunch configuration" ON public.lunch_configuration;
CREATE POLICY "School admin can update their lunch configuration"
  ON public.lunch_configuration
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_sede'
      AND profiles.school_id = lunch_configuration.school_id
    )
  );

-- ============================================================================
-- DATOS INICIALES
-- ============================================================================

-- Insertar configuración por defecto para todas las sedes existentes
INSERT INTO public.lunch_configuration (school_id, lunch_price, order_deadline_time, order_deadline_days, cancellation_deadline_time, cancellation_deadline_days, orders_enabled)
SELECT 
  id,
  7.50, -- Precio por defecto
  '20:00:00', -- Pedidos hasta las 8pm
  1, -- Del día anterior
  '07:00:00', -- Cancelaciones hasta las 7am
  0, -- Del mismo día
  true -- Sistema habilitado
FROM public.schools
ON CONFLICT (school_id) DO NOTHING;

-- ============================================================================
-- FUNCIÓN: Validar si se puede hacer un pedido
-- ============================================================================

CREATE OR REPLACE FUNCTION can_order_lunch(
  p_school_id UUID,
  p_target_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config RECORD;
  v_deadline TIMESTAMP;
  v_now TIMESTAMP;
BEGIN
  -- Obtener configuración de la sede
  SELECT * INTO v_config
  FROM public.lunch_configuration
  WHERE school_id = p_school_id;
  
  -- Si no hay configuración, denegar
  IF NOT FOUND OR NOT v_config.orders_enabled THEN
    RETURN FALSE;
  END IF;
  
  -- Calcular fecha límite
  v_deadline := (p_target_date - v_config.order_deadline_days * INTERVAL '1 day') + v_config.order_deadline_time;
  v_now := NOW();
  
  -- Verificar si aún está dentro del plazo
  RETURN v_now <= v_deadline;
END;
$$;

-- ============================================================================
-- FUNCIÓN: Validar si se puede cancelar un pedido
-- ============================================================================

CREATE OR REPLACE FUNCTION can_cancel_lunch_order(
  p_school_id UUID,
  p_target_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config RECORD;
  v_deadline TIMESTAMP;
  v_now TIMESTAMP;
BEGIN
  -- Obtener configuración de la sede
  SELECT * INTO v_config
  FROM public.lunch_configuration
  WHERE school_id = p_school_id;
  
  -- Si no hay configuración, denegar
  IF NOT FOUND OR NOT v_config.orders_enabled THEN
    RETURN FALSE;
  END IF;
  
  -- Calcular fecha límite
  v_deadline := (p_target_date - v_config.cancellation_deadline_days * INTERVAL '1 day') + v_config.cancellation_deadline_time;
  v_now := NOW();
  
  -- Verificar si aún está dentro del plazo
  RETURN v_now <= v_deadline;
END;
$$;

-- ============================================================================
-- COMENTARIOS
-- ============================================================================

COMMENT ON TABLE public.lunch_configuration IS 'Configuración de sistema de almuerzos por sede';
COMMENT ON COLUMN public.lunch_configuration.lunch_price IS 'Precio del almuerzo en soles';
COMMENT ON COLUMN public.lunch_configuration.order_deadline_time IS 'Hora límite para hacer pedidos';
COMMENT ON COLUMN public.lunch_configuration.order_deadline_days IS 'Días de anticipación para hacer pedidos (ej: 1 = día anterior)';
COMMENT ON COLUMN public.lunch_configuration.cancellation_deadline_time IS 'Hora límite para cancelar pedidos';
COMMENT ON COLUMN public.lunch_configuration.cancellation_deadline_days IS 'Días de anticipación para cancelar (ej: 0 = mismo día)';
COMMENT ON COLUMN public.lunch_configuration.orders_enabled IS 'Habilitar o deshabilitar el sistema de pedidos';

-- ============================================================================
-- FIN DEL SCRIPT
-- ============================================================================
