-- ============================================================================
-- FASE 1A — FUNDACIÓN DE LA COLA DE EMISIÓN ASÍNCRONA (MODO SOMBRA)
-- Proyecto: Lima Café 28  ·  Fecha: 2026-06-21
-- ============================================================================
--
-- QUÉ HACE (en simple):
--   Prepara la tabla `billing_queue` para convertirse en una cola de trabajos
--   de facturación tolerante a fallos. SOLO agrega columnas, estados y reglas
--   de integridad. NO cambia ningún flujo que hoy funciona.
--
-- POR QUÉ ES SEGURO (no rompe nada):
--   · Todas las columnas nuevas son NULLABLES (ningún INSERT existente falla).
--   · `idempotency_key` NO se vuelve obligatorio: su unicidad se aplica con un
--     índice ÚNICO PARCIAL (solo filas con clave NOT NULL). Los INSERT viejos
--     (izipay-webhook, process_traditional_voucher_approval) NO setean la clave
--     → quedan en NULL → nunca chocan con el índice. Siguen funcionando igual.
--   · Los CHECK de estado se AMPLÍAN (se agregan estados nuevos); jamás se quita
--     un estado existente. Nada que hoy es válido deja de serlo.
--   · NINGUNA función, worker ni componente del frontend usa todavía estas
--     columnas/estados. Esto es "modo sombra": la estructura existe, pero el
--     comportamiento del sistema es idéntico al de antes de aplicarla.
--   · Las restricciones CHECK nuevas pasan sobre las filas existentes:
--       - reserva coherente: filas viejas tienen reserved_* en NULL → válido.
--       - job_type permite NULL → filas viejas válidas.
--
-- QUÉ NO TOCA (límite explícito de esta migración):
--   · Triggers de saldo (on_transaction_created / trg_transactions_balance_sync)
--     → Fase 3, ventana de mantenimiento separada.
--   · Izipay / webhooks / HMAC / logs_pasarela / apply_gateway_credit (Regla 0.A).
--   · generate-document, el worker y el frontend → Fases 1B/1C.
--   · invoice_sequences (la unicidad de correlativo ya está garantizada por
--     uq_invoice_serie_numero en `invoices`).
--
-- IMPORTANTE: este archivo NO se ejecuta solo. Revísalo y aplícalo manualmente
--   en Supabase (idealmente primero en una rama/preview). Al ser 100% aditivo,
--   ejecutarlo no afecta dinero, saldos ni comprobantes ya emitidos.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 1: Columnas nuevas en billing_queue (todas nullable → INSERTs viejos OK)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.billing_queue
  ADD COLUMN IF NOT EXISTS job_type         text,        -- tipo de trabajo (ver CHECK)
  ADD COLUMN IF NOT EXISTS idempotency_key  text,        -- candado anti-duplicado (único parcial)
  ADD COLUMN IF NOT EXISTS transaction_ids  uuid[],      -- N transacciones → 1 boleta (daily_summary)
  ADD COLUMN IF NOT EXISTS payload_snapshot jsonb,       -- payload CONGELADO por el RPC de enqueue
  ADD COLUMN IF NOT EXISTS emission_date    date,         -- fecha Lima calculada en SQL al encolar
  ADD COLUMN IF NOT EXISTS reserved_serie   text,         -- serie reservada (la asigna SOLO el worker)
  ADD COLUMN IF NOT EXISTS reserved_numero  integer,      -- correlativo reservado (la asigna SOLO el worker)
  ADD COLUMN IF NOT EXISTS reserved_at      timestamptz,  -- cuándo se reservó el número
  ADD COLUMN IF NOT EXISTS invoice_id       uuid,         -- comprobante final (al marcar emitted)
  ADD COLUMN IF NOT EXISTS fatal_reason     text,         -- motivo SUNAT cuando dead_letter/blocked
  ADD COLUMN IF NOT EXISTS days_since_sale  integer;      -- antigüedad en días (candado extemporáneo)

COMMENT ON COLUMN public.billing_queue.job_type IS
  'Origen del trabajo de facturación: voucher | gateway_tx | pos_sale | daily_summary | manual | credit_note. '
  'NULL permitido para filas históricas creadas por flujos legacy.';
COMMENT ON COLUMN public.billing_queue.idempotency_key IS
  'Candado primario de idempotencia, generado de forma determinística en PostgreSQL. '
  'Único (índice parcial). NULL en filas legacy que no pasan por enqueue_billing_emission.';
COMMENT ON COLUMN public.billing_queue.payload_snapshot IS
  'Payload congelado por el RPC de enqueue (montos, ítems, cliente, igv). '
  'El worker lo usa tal cual; PROHIBIDO recalcular montos en el worker o el frontend.';
COMMENT ON COLUMN public.billing_queue.reserved_numero IS
  'Correlativo comprometido con esta fila. Si NOT NULL, todo reintento DEBE reutilizarlo '
  'en lugar de pedir uno nuevo a get_next_invoice_numero (garantía de cero huecos SUNAT).';

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 2: FK invoice_id → invoices (ON DELETE SET NULL). Idempotente.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billing_queue'::regclass
      AND conname  = 'fk_billing_queue_invoice'
  ) THEN
    ALTER TABLE public.billing_queue
      ADD CONSTRAINT fk_billing_queue_invoice
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK fk_billing_queue_invoice creada.';
  ELSE
    RAISE NOTICE 'FK fk_billing_queue_invoice ya existe. Omitido.';
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 3: CHECK de job_type (permite NULL para legacy). Re-ejecutable.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.billing_queue
  DROP CONSTRAINT IF EXISTS chk_billing_queue_job_type;
ALTER TABLE public.billing_queue
  ADD  CONSTRAINT chk_billing_queue_job_type
  CHECK (
    job_type IS NULL
    OR job_type IN ('voucher', 'gateway_tx', 'pos_sale', 'daily_summary', 'manual', 'credit_note')
  );

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 4: CHECK de coherencia de reserva (todo-o-nada). Re-ejecutable.
--   Las filas existentes tienen reserved_* en NULL → cumplen la rama "todo NULL".
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.billing_queue
  DROP CONSTRAINT IF EXISTS chk_billing_queue_reservation_coherence;
ALTER TABLE public.billing_queue
  ADD  CONSTRAINT chk_billing_queue_reservation_coherence
  CHECK (
    (reserved_serie IS NULL     AND reserved_numero IS NULL     AND reserved_at IS NULL)
    OR
    (reserved_serie IS NOT NULL AND reserved_numero IS NOT NULL AND reserved_at IS NOT NULL)
  );

-- Correlativo reservado siempre positivo (o NULL).
ALTER TABLE public.billing_queue
  DROP CONSTRAINT IF EXISTS chk_billing_queue_reserved_numero_pos;
ALTER TABLE public.billing_queue
  ADD  CONSTRAINT chk_billing_queue_reserved_numero_pos
  CHECK (reserved_numero IS NULL OR reserved_numero > 0);

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 5: Ampliar el CHECK de status de billing_queue (AGREGA estados, no quita).
--   Estados nuevos: 'dead_letter' (rechazo permanente / reintentos agotados),
--                   'blocked_extemporaneo' (> 7 días, SUNAT no acepta).
--   Se busca el CHECK actual por su definición (contiene 'emitted') y se reemplaza.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c TEXT;
BEGIN
  -- Eliminar el CHECK de status preexistente (auto-nombrado o nombrado por esta migración)
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.billing_queue'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%emitted%'
  LOOP
    EXECUTE 'ALTER TABLE public.billing_queue DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
    RAISE NOTICE 'CHECK de status (%) eliminado para ampliarlo.', c;
  END LOOP;
END;
$$;

ALTER TABLE public.billing_queue
  ADD CONSTRAINT billing_queue_status_check
  CHECK (status IN (
    'pending',              -- en cola, sin número reservado
    'processing',           -- el worker la tomó; puede tener reserved_numero
    'emitted',              -- comprobante creado y vinculado (invoice_id)
    'failed',               -- error transitorio o corregible; reintentable
    'cancelled',            -- anulada antes de emitir (estado legacy preservado)
    'dead_letter',          -- rechazo permanente o reintentos agotados
    'blocked_extemporaneo'  -- > 7 días; SUNAT no acepta. Requiere gestión manual.
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 6: Índice ÚNICO PARCIAL de idempotencia.
--   Solo aplica a filas con idempotency_key NOT NULL → las filas legacy (NULL)
--   quedan fuera del índice y nunca generan conflicto. El RPC enqueue usará
--   ON CONFLICT contra este índice.
-- ────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_queue_idempotency_key
  ON public.billing_queue (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 7: Índices operativos para el worker FIFO por sede y auditoría de reserva.
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_billing_queue_fifo_by_school
  ON public.billing_queue (school_id, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_billing_queue_reserved
  ON public.billing_queue (reserved_serie, reserved_numero)
  WHERE reserved_numero IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 8: Estado 'queued' en transactions.billing_status (AGREGA, no quita).
--   'queued' = "encolada para facturar, SIN correlativo asignado".
--   Distinto de 'processing' (que en el Cierre Mensual significa lock de boleteo).
--   Se busca el CHECK actual por definición y se reemplaza ampliándolo.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%billing_status%'
  LOOP
    EXECUTE 'ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
    RAISE NOTICE 'CHECK de transactions.billing_status (%) eliminado para ampliarlo.', c;
  END LOOP;
END;
$$;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_billing_status_check
  CHECK (billing_status IN (
    'pending',     -- pendiente de enviar a SUNAT
    'queued',      -- encolada en billing_queue, SIN correlativo (nuevo flujo asíncrono)
    'processing',  -- lock atómico durante boleteo (Cierre Mensual)
    'sent',        -- comprobante emitido en Nubefact
    'excluded',    -- excluido de facturación (efectivo / ticket sin DNI)
    'failed'       -- error al emitir (requiere reintento)
  ));

COMMENT ON COLUMN public.transactions.billing_status IS
  'Estado fiscal de la transacción. Flujo asíncrono nuevo: pending/failed → queued '
  '(encolada, sin número) → processing (worker) → sent (emitida). '
  'NUNCA se asigna correlativo en queued; eso es responsabilidad exclusiva del worker.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (solo lectura — ejecutar después de aplicar, no cambia nada)
-- ============================================================================
-- 1) Columnas nuevas presentes en billing_queue:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'billing_queue'
--   AND column_name IN (
--     'job_type','idempotency_key','transaction_ids','payload_snapshot',
--     'emission_date','reserved_serie','reserved_numero','reserved_at',
--     'invoice_id','fatal_reason','days_since_sale'
--   )
-- ORDER BY column_name;

-- 2) CHECKs e índices nuevos:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.billing_queue'::regclass AND contype = 'c'
-- ORDER BY conname;

-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'billing_queue'
--   AND indexname LIKE 'uq_billing_queue_idempotency%'
--    OR indexname LIKE 'idx_billing_queue_%';

-- 3) Estado 'queued' aceptado en transactions:
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.transactions'::regclass
--   AND conname = 'transactions_billing_status_check';

-- 4) Confirmar que NINGUNA fila quedó inválida (debe devolver 0):
-- SELECT count(*) AS filas_legacy_intactas FROM public.billing_queue
-- WHERE idempotency_key IS NULL;   -- todas las viejas siguen ahí, sin tocar
-- ============================================================================
