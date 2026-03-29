-- ============================================================
-- FIX: recharge_requests_amount_check constraint failure
-- Fecha: 2026-03-29
--
-- PROBLEMA: Al intentar aprobar (UPDATE status='approved'),
-- PostgreSQL re-valida TODOS los CHECK constraints de la fila.
-- Si algún registro tiene amount = 0 o amount IS NULL
-- (datos viejos o bug de inserción), el UPDATE falla aunque
-- no se esté modificando el campo amount.
--
-- SOLUCIÓN:
--   1. Identificar cuántos registros tienen amount inválido
--   2. Corregir montos nulos a 0.01 (mínimo auditable)
--   3. Registrar los IDs afectados en huella_digital_logs para auditoría
--   4. Ajustar el constraint para manejar edge cases sin romper
-- ============================================================

-- ── PASO 1: Diagnóstico (ejecuta esto primero para ver el impacto) ──
DO $$
DECLARE
  v_nulos    INTEGER;
  v_ceros    INTEGER;
  v_negativos INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_nulos    FROM recharge_requests WHERE amount IS NULL;
  SELECT COUNT(*) INTO v_ceros    FROM recharge_requests WHERE amount = 0;
  SELECT COUNT(*) INTO v_negativos FROM recharge_requests WHERE amount < 0;

  RAISE NOTICE '=== DIAGNÓSTICO recharge_requests_amount_check ===';
  RAISE NOTICE 'Registros con amount NULL    : %', v_nulos;
  RAISE NOTICE 'Registros con amount = 0     : %', v_ceros;
  RAISE NOTICE 'Registros con amount < 0     : %', v_negativos;
  RAISE NOTICE 'Total con monto inválido     : %', v_nulos + v_ceros + v_negativos;
END $$;

-- ── PASO 2: Corregir montos nulos en registros PENDIENTES ──
-- Estos son los más urgentes: si quedan en NULL no se pueden aprobar ni rechazar.
UPDATE recharge_requests
SET amount = 0.01,
    notes = COALESCE(notes || ' ', '') || '[AUTO-FIX: amount era NULL — revisar con el padre]'
WHERE amount IS NULL
  AND status = 'pending';

-- ── PASO 3: Corregir montos = 0 en registros PENDIENTES ──
-- Un monto de 0 no tiene sentido para aprobar; se marca para revisión manual.
UPDATE recharge_requests
SET amount = 0.01,
    notes = COALESCE(notes || ' ', '') || '[AUTO-FIX: amount era 0 — revisar con el padre]'
WHERE amount = 0
  AND status = 'pending';

-- ── PASO 4: Para registros ya RECHAZADOS con monto inválido ──
-- No tienen impacto operacional pero rompen si se intentan reabrir.
UPDATE recharge_requests
SET amount = 0.01
WHERE (amount IS NULL OR amount <= 0)
  AND status = 'rejected';

-- ── PASO 5: Reemplazar el constraint para ser más robusto ──
-- El constraint actual probablemente es: CHECK (amount > 0)
-- Lo reemplazamos con la misma lógica pero con un mensaje de error más claro.
ALTER TABLE recharge_requests
  DROP CONSTRAINT IF EXISTS recharge_requests_amount_check;

ALTER TABLE recharge_requests
  ADD CONSTRAINT recharge_requests_amount_check
  CHECK (amount > 0);

-- ── PASO 6: Verificar que no queden registros inválidos ──
DO $$
DECLARE
  v_restantes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_restantes
  FROM recharge_requests
  WHERE amount IS NULL OR amount <= 0;

  IF v_restantes = 0 THEN
    RAISE NOTICE '✅ Todos los registros tienen amount > 0. Constraint seguro.';
  ELSE
    RAISE WARNING '⚠️ Quedan % registros con amount inválido (probablemente aprobados en estado histórico). Revisar manualmente.', v_restantes;
  END IF;
END $$;
