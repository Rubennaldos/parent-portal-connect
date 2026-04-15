-- ============================================================================
-- MIGRACIÓN: Agregar 'processing' al CHECK de billing_status
--            + garantizar que billing_processing_at exista
-- Fecha: 2026-04-15
--
-- PROBLEMA RAÍZ:
--   El CHECK constraint original solo permite:
--     ('pending', 'sent', 'excluded', 'failed')
--
--   Cuando CierreMensual / auto-invoice intenta:
--     UPDATE transactions SET billing_status = 'processing' ...
--   PostgreSQL rechaza con 400 Bad Request (violación del CHECK).
--   Consecuencia: el lock atómico nunca consigue "tomar" las transacciones
--   y lockedCount = 0 → la boleta nunca se emite aunque el botón diga "Emitiendo...".
--
--   Además, la columna billing_processing_at puede no existir si la migración
--   20260401_billing_hardening.sql no fue ejecutada en producción → 400 en
--   el zombie-count al cargar CierreMensual.
--
-- SOLUCIÓN:
--   1. Agregar billing_processing_at con IF NOT EXISTS (idempotente).
--   2. Reemplazar el CHECK para incluir 'processing'.
-- ============================================================================

-- ── 1. Columna billing_processing_at (TTL anti-zombie) ───────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS billing_processing_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.transactions.billing_processing_at IS
  'Timestamp de cuando se marcó billing_status=processing. '
  'Si lleva >30 min en ese estado, el sistema lo regresa a pending (TTL anti-zombie).';

-- Índice parcial para que el zombie-scan sea instantáneo
CREATE INDEX IF NOT EXISTS idx_transactions_billing_processing_at
  ON public.transactions (school_id, billing_processing_at)
  WHERE billing_status = 'processing';

-- ── 2. Reemplazar CHECK constraint para incluir 'processing' ─────────────────
-- Eliminar cualquier constraint existente que afecte billing_status
-- (el nombre puede variar según cuándo fue creado)
DO $$
DECLARE
  c TEXT;
BEGIN
  -- Buscar el constraint por su definición (más robusto que usar el nombre exacto)
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.transactions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%billing_status%';

  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
    RAISE NOTICE 'Constraint % eliminado.', c;
  ELSE
    RAISE NOTICE 'No se encontró constraint de billing_status. Continuando.';
  END IF;
END;
$$;

-- Agregar el constraint actualizado con los 5 estados válidos:
--   pending    = pendiente de emitir
--   processing = lock atómico (la boleta está siendo generada ahora mismo)
--   sent       = comprobante emitido en Nubefact
--   excluded   = excluido de facturación (efectivo/ticket sin DNI)
--   failed     = error al emitir (requiere reintento)
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_billing_status_check
  CHECK (billing_status IN ('pending', 'processing', 'sent', 'excluded', 'failed'));

-- ── 3. Verificación ──────────────────────────────────────────────────────────
SELECT
  conname                   AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.transactions'::regclass
  AND contype = 'c'
  AND conname = 'transactions_billing_status_check';
