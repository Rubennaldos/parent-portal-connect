-- ============================================================
-- FIX: Agregar 'failed' a billing_status CHECK constraint
-- Fecha: 2026-04-09
--
-- PROBLEMA: El constraint original solo permite:
--   ('pending', 'sent', 'excluded')
--
-- Cuando Nubefact falla al emitir un comprobante, el código
-- intenta guardar billing_status = 'failed'. PostgreSQL lo
-- rechaza con 400 Bad Request porque 'failed' no estaba
-- en la lista del CHECK.
--
-- SOLUCIÓN: Reemplazar el CHECK para incluir 'failed'.
-- ============================================================

-- 1. Eliminar el constraint antiguo (nombre auto-generado por Postgres)
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_billing_status_check;

-- Por si el constraint tiene otro nombre (doble seguridad)
DO $$
DECLARE
  c TEXT;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.transactions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%billing_status%';

  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
  END IF;
END;
$$;

-- 2. Añadir el constraint actualizado con 'failed' incluido
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_billing_status_check
  CHECK (billing_status IN ('pending', 'sent', 'excluded', 'failed'));

-- 3. Verificación
SELECT
  conname                    AS constraint_name,
  pg_get_constraintdef(oid)  AS definition
FROM pg_constraint
WHERE conrelid = 'public.transactions'::regclass
  AND contype = 'c'
  AND conname = 'transactions_billing_status_check';
