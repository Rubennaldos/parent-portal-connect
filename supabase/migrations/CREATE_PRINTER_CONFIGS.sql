-- =====================================================
-- MIGRACIÓN: Configuración de Impresoras por Sede
-- Descripción: Tabla para gestionar configuraciones de impresión
--              por cada sede (logos, plantillas, formatos)
-- Autor: Sistema
-- Fecha: 2026-02-01
-- =====================================================

-- Crear tabla de configuración de impresoras
CREATE TABLE IF NOT EXISTS public.printer_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  
  -- Información básica
  printer_name VARCHAR(100) NOT NULL DEFAULT 'Impresora Principal',
  is_active BOOLEAN DEFAULT true,
  
  -- Logo de la sede
  logo_url TEXT, -- URL del logo almacenado en Supabase Storage
  logo_width INTEGER DEFAULT 120, -- Ancho del logo en pixeles
  logo_height INTEGER DEFAULT 60, -- Alto del logo en pixeles
  
  -- Configuración del ticket/recibo
  paper_width INTEGER DEFAULT 80, -- Ancho del papel en mm (58mm, 80mm, etc)
  print_header BOOLEAN DEFAULT true,
  print_footer BOOLEAN DEFAULT true,
  header_text TEXT DEFAULT 'Recibo de Compra',
  footer_text TEXT DEFAULT 'Gracias por su preferencia',
  
  -- Información del negocio en el ticket
  business_name TEXT,
  business_address TEXT,
  business_phone VARCHAR(50),
  business_ruc VARCHAR(20),
  
  -- Configuración visual
  font_size VARCHAR(20) DEFAULT 'normal', -- small, normal, large
  font_family VARCHAR(50) DEFAULT 'monospace',
  show_qr_code BOOLEAN DEFAULT false,
  show_barcode BOOLEAN DEFAULT false,
  
  -- Configuración de impresión por defecto
  auto_print BOOLEAN DEFAULT false, -- Imprimir automáticamente después de una venta
  copies INTEGER DEFAULT 1, -- Número de copias por defecto
  
  -- Plantilla personalizada (JSON)
  custom_template JSONB, -- Para almacenar plantillas personalizadas
  
  -- Metadatos
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  
  -- Constraint: Una configuración activa por sede
  CONSTRAINT unique_active_config_per_school 
    UNIQUE (school_id, is_active) 
    WHERE is_active = true
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_printer_configs_school_id 
  ON public.printer_configs(school_id);

CREATE INDEX IF NOT EXISTS idx_printer_configs_active 
  ON public.printer_configs(is_active) 
  WHERE is_active = true;

-- Comentarios en la tabla y columnas
COMMENT ON TABLE public.printer_configs IS 
  'Configuraciones de impresión para cada sede (logos, plantillas, formato de tickets)';

COMMENT ON COLUMN public.printer_configs.school_id IS 
  'ID de la sede a la que pertenece esta configuración';

COMMENT ON COLUMN public.printer_configs.logo_url IS 
  'URL del logo de la sede almacenado en Supabase Storage';

COMMENT ON COLUMN public.printer_configs.custom_template IS 
  'Plantilla personalizada en formato JSON para tickets especiales';

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_printer_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_printer_configs_updated_at 
  ON public.printer_configs;

CREATE TRIGGER trigger_update_printer_configs_updated_at
  BEFORE UPDATE ON public.printer_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_printer_configs_updated_at();

-- RLS (Row Level Security)
ALTER TABLE public.printer_configs ENABLE ROW LEVEL SECURITY;

-- Policy: SuperAdmin puede ver todas las configuraciones
DROP POLICY IF EXISTS "superadmin_view_printer_configs" ON public.printer_configs;
CREATE POLICY "superadmin_view_printer_configs"
  ON public.printer_configs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );

-- Policy: SuperAdmin puede insertar configuraciones
DROP POLICY IF EXISTS "superadmin_insert_printer_configs" ON public.printer_configs;
CREATE POLICY "superadmin_insert_printer_configs"
  ON public.printer_configs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );

-- Policy: SuperAdmin puede actualizar configuraciones
DROP POLICY IF EXISTS "superadmin_update_printer_configs" ON public.printer_configs;
CREATE POLICY "superadmin_update_printer_configs"
  ON public.printer_configs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );

-- Policy: Admin General puede ver configuraciones de su sede
DROP POLICY IF EXISTS "admin_general_view_printer_configs" ON public.printer_configs;
CREATE POLICY "admin_general_view_printer_configs"
  ON public.printer_configs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin_general'
      AND profiles.school_id = printer_configs.school_id
    )
  );

-- Policy: Cajeros pueden ver configuraciones de su sede (para imprimir)
DROP POLICY IF EXISTS "cajero_view_printer_configs" ON public.printer_configs;
CREATE POLICY "cajero_view_printer_configs"
  ON public.printer_configs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'cajero'
      AND profiles.school_id = printer_configs.school_id
    )
  );

-- Insertar configuraciones por defecto para cada sede existente
INSERT INTO public.printer_configs (
  school_id,
  printer_name,
  is_active,
  business_name,
  paper_width,
  header_text,
  footer_text
)
SELECT 
  id,
  'Impresora ' || name,
  true,
  name,
  80,
  'Recibo de Compra',
  'Gracias por su preferencia'
FROM public.schools
WHERE NOT EXISTS (
  SELECT 1 FROM public.printer_configs 
  WHERE printer_configs.school_id = schools.id
);

-- Verificar creación
SELECT 
  pc.id,
  s.name AS sede,
  pc.printer_name,
  pc.is_active,
  pc.paper_width || 'mm' AS ancho_papel,
  pc.created_at
FROM public.printer_configs pc
INNER JOIN public.schools s ON pc.school_id = s.id
ORDER BY s.name;
