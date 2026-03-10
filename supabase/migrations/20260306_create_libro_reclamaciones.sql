-- ============================================================
-- Tabla para el Libro de Reclamaciones (INDECOPI - Perú)
-- Todos los campos son obligatorios excepto nombre_apoderado
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reclamaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  numero SERIAL,                        -- Número de hoja correlativo
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Datos del proveedor (pre-llenado)
  proveedor TEXT NOT NULL DEFAULT 'UFRASAC CATERING S.AC',
  ruc TEXT NOT NULL DEFAULT '20603916060',
  domicilio_proveedor TEXT NOT NULL DEFAULT 'CALLE LOS CIPRESES 165 URB EL REMANSO LA MOLINA',

  -- Sede (obligatorio)
  school_id UUID REFERENCES public.schools(id) NOT NULL,

  -- Sección 1: Identificación del consumidor (todos obligatorios)
  nombre_consumidor TEXT NOT NULL,
  dni_ce TEXT NOT NULL,
  domicilio_consumidor TEXT NOT NULL,
  telefono TEXT NOT NULL,
  email TEXT NOT NULL,
  nombre_apoderado TEXT,               -- Único campo opcional (si es menor de edad)

  -- Sección 2: Identificación del bien contratado (todos obligatorios)
  tipo_bien TEXT NOT NULL CHECK (tipo_bien IN ('producto', 'servicio')),
  monto_reclamado NUMERIC(10,2) NOT NULL,
  descripcion_bien TEXT NOT NULL,

  -- Sección 3: Detalle de la reclamación (todos obligatorios)
  tipo_reclamacion TEXT NOT NULL CHECK (tipo_reclamacion IN ('reclamo', 'queja')),
  detalle TEXT NOT NULL,
  pedido_consumidor TEXT NOT NULL,

  -- Estado y respuesta del proveedor
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'resuelto')),
  respuesta_proveedor TEXT,
  fecha_respuesta DATE,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_reclamaciones_fecha ON public.reclamaciones(fecha);
CREATE INDEX IF NOT EXISTS idx_reclamaciones_estado ON public.reclamaciones(estado);
CREATE INDEX IF NOT EXISTS idx_reclamaciones_school ON public.reclamaciones(school_id);
CREATE INDEX IF NOT EXISTS idx_reclamaciones_numero ON public.reclamaciones(numero);

-- RLS
ALTER TABLE public.reclamaciones ENABLE ROW LEVEL SECURITY;

-- Cualquiera puede insertar (incluso sin sesión, para el formulario público)
CREATE POLICY "anyone_can_insert_reclamaciones"
  ON public.reclamaciones FOR INSERT
  WITH CHECK (true);

-- Solo admin_general, superadmin y gestor_unidad pueden ver
CREATE POLICY "admins_can_view_reclamaciones"
  ON public.reclamaciones FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad')
    )
  );

-- Solo admin_general, superadmin y gestor_unidad pueden actualizar
CREATE POLICY "admins_can_update_reclamaciones"
  ON public.reclamaciones FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad')
    )
  );
