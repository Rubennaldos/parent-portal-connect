-- ============================================================
-- Tabla: maintenance_config
-- Modo mantenimiento por módulo por sede
-- ============================================================

CREATE TABLE IF NOT EXISTS public.maintenance_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID REFERENCES public.schools(id) NOT NULL,
  module_key TEXT NOT NULL, -- ej: 'almuerzos_padres', 'pagos_padres'
  enabled BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL DEFAULT 'Módulo en Mantenimiento',
  message TEXT NOT NULL DEFAULT 'Estamos trabajando para ofrecerte la mejor experiencia. Pronto estará disponible.',
  bypass_emails TEXT[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, module_key)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_maintenance_config_school ON public.maintenance_config(school_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_config_module ON public.maintenance_config(module_key);

-- RLS
ALTER TABLE public.maintenance_config ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede LEER (los padres necesitan saber si hay mantenimiento)
CREATE POLICY "authenticated_can_read_maintenance"
  ON public.maintenance_config FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Admins pueden insertar
CREATE POLICY "admins_can_insert_maintenance"
  ON public.maintenance_config FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad')
    )
  );

-- Admins pueden actualizar
CREATE POLICY "admins_can_update_maintenance"
  ON public.maintenance_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad')
    )
  );
