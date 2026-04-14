-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: expected_amount_on_request
-- Fecha    : 2026-04-14
--
-- QUÉ HACE:
--   Agrega la columna `expected_amount` a recharge_requests y un trigger
--   BEFORE INSERT que la calcula automáticamente desde la base de datos
--   (sumando los tickets reales de kiosco + almuerzos seleccionados).
--
-- POR QUÉ:
--   El campo `amount` del request es el monto del voucher bancario (lo que
--   el padre dice que transfirió). El admin necesita ver cuánto REALMENTE
--   suman los tickets seleccionados para saber si el voucher corresponde.
--
--   expected_amount = suma de ABS(transactions.amount) de los tickets seleccionados
--                   + suma de lunch_orders.final_price de los almuerzos seleccionados
--
-- COORDINACIÓN CON TRIGGER EXISTENTE:
--   El trigger anti-duplicados (trg_check_no_overlapping_payment_ids) es BEFORE INSERT
--   y se llama con nombre 'trg_check_...'. Este nuevo trigger se llama
--   'trg_set_expected_amount' (orden alfabético: 'set' > 'check'), por lo que
--   si el anti-duplicados falla, este nunca ejecuta — correcto.
--
-- SEGURIDAD:
--   Si el cálculo falla por cualquier razón, el INSERT NO se bloquea.
--   Se lanza un WARNING pero la operación continúa.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Columna nueva (nullable — requests anteriores tendrán NULL) ─────────
ALTER TABLE recharge_requests
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(10,2) DEFAULT NULL;

COMMENT ON COLUMN recharge_requests.expected_amount IS
  'Suma real de los ítems seleccionados (calculada por BD al crear el request). '
  'Permite al admin comparar con "amount" (voucher del padre) sin recalcular.';

-- ── 2) Función del trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_expected_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_total    NUMERIC := 0;
  v_lunch_total NUMERIC := 0;
BEGIN
  -- Solo calcular para pagos de deuda / almuerzos que traigan IDs
  IF NEW.request_type NOT IN ('debt_payment', 'lunch_payment') THEN
    RETURN NEW;
  END IF;

  -- Suma de tickets de kiosco seleccionados
  IF COALESCE(cardinality(NEW.paid_transaction_ids), 0) > 0 THEN
    SELECT COALESCE(SUM(ABS(t.amount)), 0)
    INTO   v_tx_total
    FROM   transactions t
    WHERE  t.id         = ANY(NEW.paid_transaction_ids)
      AND  t.is_deleted = false;
  END IF;

  -- Suma de almuerzos seleccionados
  IF COALESCE(cardinality(NEW.lunch_order_ids), 0) > 0 THEN
    SELECT COALESCE(SUM(COALESCE(lo.final_price, 0)), 0)
    INTO   v_lunch_total
    FROM   lunch_orders lo
    WHERE  lo.id          = ANY(NEW.lunch_order_ids)
      AND  lo.is_cancelled = false;
  END IF;

  -- Asignar solo si hay algo que sumar
  IF v_tx_total + v_lunch_total > 0 THEN
    NEW.expected_amount := v_tx_total + v_lunch_total;
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear el INSERT por un fallo en este cálculo auxiliar
  RAISE WARNING 'fn_set_expected_amount falló (no bloquea el insert): %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ── 3) Trigger (BEFORE INSERT — popula expected_amount antes de grabar) ───
DROP TRIGGER IF EXISTS trg_set_expected_amount ON recharge_requests;

CREATE TRIGGER trg_set_expected_amount
  BEFORE INSERT ON recharge_requests
  FOR EACH ROW
  EXECUTE PROCEDURE fn_set_expected_amount();

SELECT '✅ Columna expected_amount agregada y trigger instalado.' AS status;
