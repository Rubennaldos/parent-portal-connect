-- ============================================================
-- BLOQUE 1 — Infraestructura del Reporte de Ventas
-- ============================================================
-- 1. Columna report_op_seq  → ID global de auditoría financiera
--    (≠ operation_number que es la referencia del pago digital: Yape/Plin/etc.)
-- 2. Secuencia global report_operation_seq
-- 3. Trigger BEFORE INSERT → asignación atómica
-- 4. Función get_sales_week_number → semana ISO Lunes-Domingo
-- 5. Índices para filtros y búsqueda textual
-- ============================================================

-- ── 1. Columna ────────────────────────────────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS report_op_seq bigint;

COMMENT ON COLUMN public.transactions.report_op_seq IS
  'Secuencia global única para auditoría financiera (OP-000001, ...). '
  'Distinto de ticket_code (ID operativo por sede) y operation_number (referencia Yape/Plin).';

-- ── 2. Secuencia ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.report_operation_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- ── 3. Backfill filas existentes (solo las que aún no tienen valor) ───────────
-- Asigna números en orden cronológico para preservar coherencia de auditoría.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id
    FROM   public.transactions
    WHERE  report_op_seq IS NULL
    ORDER  BY created_at ASC
  LOOP
    UPDATE public.transactions
    SET    report_op_seq = nextval('public.report_operation_seq')
    WHERE  id = r.id;
  END LOOP;
END;
$$;

-- ── 4. Trigger BEFORE INSERT ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_assign_report_op_seq()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.report_op_seq IS NULL THEN
    NEW.report_op_seq := nextval('public.report_operation_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_assign_op_seq ON public.transactions;

CREATE TRIGGER trg_transactions_assign_op_seq
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_assign_report_op_seq();

-- ── 5. Función semana ISO (Lunes = día 1, Domingo = día 7) ──────────────────
-- PostgreSQL EXTRACT(ISODOW ...) devuelve 1=Lun..7=Dom.
-- EXTRACT(WEEK ...) devuelve el número de semana ISO 8601 (la que empieza el lunes).
-- No necesitamos lógica extra: ISO week ya es Lunes-Domingo.
CREATE OR REPLACE FUNCTION public.get_sales_week_number(p_ts timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT EXTRACT(WEEK FROM (p_ts AT TIME ZONE 'America/Lima'))::integer;
$$;

COMMENT ON FUNCTION public.get_sales_week_number IS
  'Devuelve el número de semana ISO 8601 (1-53). Las semanas empiezan el Lunes. '
  'Evalúa el timestamp en zona horaria America/Lima (UTC-5, sin horario de verano).';

-- ── 6. Índices ─────────────────────────────────────────────────────────────────
-- Operativo: filtro por sede + fecha (el más frecuente en reportes)
CREATE INDEX IF NOT EXISTS idx_transactions_school_created
  ON public.transactions (school_id, created_at DESC)
  WHERE is_deleted = false;

-- Búsqueda de ticket
CREATE INDEX IF NOT EXISTS idx_transactions_ticket_code
  ON public.transactions (ticket_code)
  WHERE ticket_code IS NOT NULL;

-- Búsqueda del número de operación de pago (Yape, Plin, etc.)
-- Ya existe idx_transactions_operation_number; este es adicional si no existe
CREATE INDEX IF NOT EXISTS idx_transactions_operation_number_lower
  ON public.transactions (lower(operation_number))
  WHERE operation_number IS NOT NULL;

-- ID de auditoría: único y buscable
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_report_op_seq
  ON public.transactions (report_op_seq)
  WHERE report_op_seq IS NOT NULL;

-- Búsqueda de nombre de cliente (trigram para ILIKE eficiente)
-- pg_trgm ya habilitado en 20260409_search_persons_v2.sql
CREATE INDEX IF NOT EXISTS idx_transactions_client_name_trgm
  ON public.transactions USING gin (invoice_client_name gin_trgm_ops)
  WHERE invoice_client_name IS NOT NULL;
