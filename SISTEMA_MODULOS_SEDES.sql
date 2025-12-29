-- ============================================
-- SISTEMA DE MÓDULOS Y SEDES
-- Lima Café 28 - Parent Portal Connect
-- ============================================

-- ============================================
-- 1. TABLA: modules (Módulos del Sistema)
-- ============================================
CREATE TABLE IF NOT EXISTS public.modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(50),
  route VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 2. TABLA: locations (Sedes)
-- ============================================
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 3. TABLA: pos_points (Puntos de Venta)
-- ============================================
CREATE TABLE IF NOT EXISTS public.pos_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES public.locations(id),
  name VARCHAR(200) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  series_prefix VARCHAR(10) NOT NULL,
  current_correlative INTEGER DEFAULT 1,
  max_correlative INTEGER DEFAULT 9999,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 4. TABLA: user_modules (Módulos por Usuario)
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_id UUID REFERENCES public.modules(id) ON DELETE CASCADE,
  is_enabled BOOLEAN DEFAULT true,
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, module_id)
);

-- ============================================
-- 5. TABLA: user_pos_assignment (Asignación Usuario-POS)
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_pos_assignment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  pos_point_id UUID REFERENCES public.pos_points(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  assigned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, pos_point_id)
);

-- ============================================
-- ÍNDICES para Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_user_modules_user ON user_modules(user_id);
CREATE INDEX IF NOT EXISTS idx_user_modules_module ON user_modules(module_id);
CREATE INDEX IF NOT EXISTS idx_pos_points_location ON pos_points(location_id);
CREATE INDEX IF NOT EXISTS idx_user_pos_user ON user_pos_assignment(user_id);

-- ============================================
-- DATOS INICIALES: Módulos
-- ============================================
INSERT INTO public.modules (code, name, description, icon, color, route, is_active) VALUES
('pos', 'Punto de Venta', 'Sistema de cobro y ventas', 'ShoppingCart', 'green', '/pos', true),
('cobranzas', 'Cobranzas', 'Gestión de cuentas por cobrar', 'DollarSign', 'red', '/cobranzas', true),
('config_padres', 'Configuración Padres', 'Gestión de padres y estudiantes', 'Users', 'blue', '/config-padres', true),
('auditoria', 'Auditoría', 'Logs y seguimiento del sistema', 'FileSearch', 'purple', '/auditoria', true),
('finanzas', 'Finanzas', 'Reportes financieros y análisis', 'TrendingUp', 'yellow', '/finanzas', true),
('logistica', 'Logística', 'Inventario y compras', 'Package', 'orange', '/logistica', true)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- DATOS INICIALES: Sedes
-- ============================================
INSERT INTO public.locations (name, code, address, phone, is_active) VALUES
('Sede Central', 'SEDE-001', 'Av. Principal 123, Lima', '(01) 234-5678', true),
('Sucursal Norte', 'SUC-NORTE', 'Av. Norte 456, Lima', '(01) 234-5679', true),
('Sucursal Sur', 'SUC-SUR', 'Av. Sur 789, Lima', '(01) 234-5680', true)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- DATOS INICIALES: Puntos de Venta
-- ============================================
-- Obtener IDs de sedes (ajustar según tu BD)
DO $$
DECLARE
  sede_central_id UUID;
  sucursal_norte_id UUID;
  sucursal_sur_id UUID;
BEGIN
  -- Obtener IDs
  SELECT id INTO sede_central_id FROM public.locations WHERE code = 'SEDE-001';
  SELECT id INTO sucursal_norte_id FROM public.locations WHERE code = 'SUC-NORTE';
  SELECT id INTO sucursal_sur_id FROM public.locations WHERE code = 'SUC-SUR';

  -- Puntos de Venta Sede Central
  INSERT INTO public.pos_points (location_id, name, code, series_prefix, current_correlative, is_active) VALUES
  (sede_central_id, 'Caja Principal', 'POS-001', 'F001', 1, true),
  (sede_central_id, 'Caja Secundaria', 'POS-002', 'F002', 1, true),
  (sede_central_id, 'Caja Express', 'POS-003', 'T001', 1, true)
  ON CONFLICT (code) DO NOTHING;

  -- Puntos de Venta Sucursal Norte
  INSERT INTO public.pos_points (location_id, name, code, series_prefix, current_correlative, is_active) VALUES
  (sucursal_norte_id, 'Caja 1 Norte', 'POS-004', 'F003', 1, true),
  (sucursal_norte_id, 'Caja 2 Norte', 'POS-005', 'F004', 1, true)
  ON CONFLICT (code) DO NOTHING;

  -- Puntos de Venta Sucursal Sur
  INSERT INTO public.pos_points (location_id, name, code, series_prefix, current_correlative, is_active) VALUES
  (sucursal_sur_id, 'Caja Única Sur', 'POS-006', 'F005', 1, true)
  ON CONFLICT (code) DO NOTHING;
END $$;

-- ============================================
-- FUNCIÓN: Obtener Siguiente Correlativo
-- ============================================
CREATE OR REPLACE FUNCTION get_next_correlative(pos_point_code VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
  pos_record RECORD;
  next_num INTEGER;
  formatted_correlative VARCHAR;
BEGIN
  -- Obtener el punto de venta
  SELECT series_prefix, current_correlative, max_correlative
  INTO pos_record
  FROM public.pos_points
  WHERE code = pos_point_code AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Punto de venta % no encontrado o inactivo', pos_point_code;
  END IF;

  -- Verificar que no exceda el máximo
  IF pos_record.current_correlative >= pos_record.max_correlative THEN
    RAISE EXCEPTION 'Se alcanzó el límite de correlativos para %', pos_point_code;
  END IF;

  -- Incrementar correlativo
  next_num := pos_record.current_correlative + 1;

  -- Actualizar en la base de datos
  UPDATE public.pos_points
  SET current_correlative = next_num
  WHERE code = pos_point_code;

  -- Formatear (ej: F001-00001)
  formatted_correlative := pos_record.series_prefix || '-' || LPAD(next_num::TEXT, 5, '0');

  RETURN formatted_correlative;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VERIFICAR INSTALACIÓN
-- ============================================
SELECT 'Módulos creados:' as info, COUNT(*) as total FROM public.modules;
SELECT 'Sedes creadas:' as info, COUNT(*) as total FROM public.locations;
SELECT 'Puntos de Venta creados:' as info, COUNT(*) as total FROM public.pos_points;

-- Ver Puntos de Venta por Sede
SELECT 
  l.name as sede,
  p.name as punto_venta,
  p.series_prefix as serie,
  p.current_correlative as correlativo_actual
FROM public.pos_points p
JOIN public.locations l ON p.location_id = l.id
ORDER BY l.name, p.name;

