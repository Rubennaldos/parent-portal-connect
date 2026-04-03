-- ============================================================
-- TABLA system_status — Cierre global de sistemas
-- Fecha: 2026-04-03
--
-- Un solo registro con id=1 controla el estado de los dos portales.
-- El SuperAdmin puede apagar/encender desde el panel sin deploy.
-- El guard de rutas consulta esta tabla en cada carga para redirigir.
-- REGLA DE ORO: superadmin NUNCA es bloqueado por este sistema.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_status (
  id                        int  PRIMARY KEY DEFAULT 1,
  is_parent_portal_enabled  boolean NOT NULL DEFAULT true,
  is_admin_panel_enabled    boolean NOT NULL DEFAULT true,
  parent_maintenance_msg    text DEFAULT 'Estamos realizando mejoras para ti. Volvemos pronto.',
  admin_maintenance_msg     text DEFAULT 'Sistema en mantenimiento programado. Contacta al SuperAdmin.',
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insertar el registro único si no existe
INSERT INTO public.system_status (id, is_parent_portal_enabled, is_admin_panel_enabled)
VALUES (1, true, true)
ON CONFLICT (id) DO NOTHING;

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION fn_system_status_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_system_status_updated_at ON public.system_status;
CREATE TRIGGER trg_system_status_updated_at
  BEFORE UPDATE ON public.system_status
  FOR EACH ROW EXECUTE FUNCTION fn_system_status_updated_at();

-- RLS
ALTER TABLE public.system_status ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado (los guards necesitan leer esto)
DROP POLICY IF EXISTS "system_status_read_all" ON public.system_status;
CREATE POLICY "system_status_read_all" ON public.system_status
  FOR SELECT TO authenticated
  USING (true);

-- Escritura: SOLO superadmin puede cambiar los flags
DROP POLICY IF EXISTS "system_status_write_superadmin" ON public.system_status;
CREATE POLICY "system_status_write_superadmin" ON public.system_status
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );

SELECT '20260403_system_status ✅ Tabla system_status creada. Portal parent=ON, Admin=ON.' AS resultado;
