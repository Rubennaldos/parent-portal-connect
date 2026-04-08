-- ============================================================
-- AUTO-BOLETEO: Configuración por sede + Logs de ejecución
-- ============================================================
-- Permite configurar una hora diaria de cierre automático
-- por cada sede. El cron job (api/cron/auto-invoice.ts)
-- consulta estas columnas para decidir qué sedes procesar.
-- ============================================================

-- ── 1. Campos nuevos en schools ──────────────────────────────
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS auto_facturacion_activa BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hora_cierre_diario      TIME    DEFAULT '23:00';

COMMENT ON COLUMN public.schools.auto_facturacion_activa IS
  'Si true, el cron ejecuta el Cierre Mensual automáticamente a la hora configurada.';
COMMENT ON COLUMN public.schools.hora_cierre_diario IS
  'Hora Lima (UTC-5) en que se ejecuta el auto-boleteo. Ej: 23:00:00 = 11 PM.';

-- ── 2. Tabla de logs del cron ────────────────────────────────
-- Registra cada ejecución del auto-boleteo: sede, fecha, resultado y detalle.
-- Sirve también como CANDADO DE IDEMPOTENCIA: si ya hay un registro 'ok'
-- para (school_id, fecha_proceso), el cron omite esa sede ese día.
CREATE TABLE IF NOT EXISTS public.logs_auto_facturacion (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  fecha_proceso DATE         NOT NULL,
  -- 'ok'             = todo correcto
  -- 'error'          = Nubefact u otro error; ver campo detalle
  -- 'sin_pendientes' = no había transacciones pendientes ese día
  -- 'ya_procesado'   = el cron detectó que ya se procesó (idempotencia)
  estado        TEXT         NOT NULL
                CHECK (estado IN ('ok', 'error', 'sin_pendientes', 'ya_procesado')),
  dias_emitidos INT          NOT NULL DEFAULT 0,
  monto_total   NUMERIC(10,2) NOT NULL DEFAULT 0,
  detalle       JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Índice principal para la consulta de idempotencia (busca por sede + fecha)
CREATE INDEX IF NOT EXISTS idx_logs_auto_fact_school_fecha
  ON public.logs_auto_facturacion (school_id, fecha_proceso);

-- Índice para auditoría: ver todos los logs de una fecha
CREATE INDEX IF NOT EXISTS idx_logs_auto_fact_fecha
  ON public.logs_auto_facturacion (fecha_proceso DESC);

-- ── 3. RLS: solo admins leen/escriben logs ───────────────────
ALTER TABLE public.logs_auto_facturacion ENABLE ROW LEVEL SECURITY;

-- El cron usa service_role (bypassa RLS) — estas políticas son para UI admin
CREATE POLICY "Admins pueden ver logs auto-facturación"
  ON public.logs_auto_facturacion
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_general', 'superadmin', 'gestor_unidad')
    )
  );

CREATE POLICY "Solo service_role puede insertar logs"
  ON public.logs_auto_facturacion
  FOR INSERT
  WITH CHECK (false); -- Solo service_role (cron) puede insertar; bypassa RLS automáticamente
