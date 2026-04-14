-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: guard_no_duplicate_payment_requests
-- Fecha    : 2026-04-14
--
-- PROBLEMA RAÍZ:
--   Un padre podía enviar dos solicitudes de pago que incluían los mismos
--   tickets de kiosco (paid_transaction_ids solapados) mientras ambos estaban
--   pendientes. El admin veía los mismos tickets en dos solicitudes distintas,
--   causando confusión y montos incorrectos (ej: S/ 77 que incluía S/ 13 ya
--   cubiertos por otra solicitud aprobada).
--
-- SOLUCIÓN:
--   Trigger BEFORE INSERT en recharge_requests que comprueba:
--   1. ¿Alguno de los paid_transaction_ids del nuevo request ya está en
--      otro request del mismo alumno con status = 'pending'?
--   2. ¿Alguno de los lunch_order_ids del nuevo request ya está en
--      otro request pendiente?
--   Si hay solapamiento → lanza excepción DUPLICATE_PAYMENT con mensaje claro.
--
-- ALCANCE DEL CANDADO:
--   Solo bloquea contra requests en estado 'pending' (en revisión).
--   Los requests 'rejected' (rechazados) NO bloquean → el padre puede reintentar.
--   Los requests 'approved' NO bloquean → esos tickets ya están 'paid' en
--   transactions y no aparecen en view_student_debts (no llegará al frontend).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_check_no_overlapping_payment_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_overlap_tx    int := 0;
  v_overlap_lunch int := 0;
  v_conflicting_request_id uuid;
BEGIN
  -- Solo aplica a solicitudes de pago de deuda / almuerzos
  IF NEW.request_type NOT IN ('debt_payment', 'lunch_payment') THEN
    RETURN NEW;
  END IF;

  -- ── CANDADO 1: paid_transaction_ids ──────────────────────────────────────
  -- Bloquear si algún ticket ya está en un request PENDIENTE del mismo alumno
  IF COALESCE(cardinality(NEW.paid_transaction_ids), 0) > 0 THEN
    SELECT rr.id, COUNT(*)
    INTO   v_conflicting_request_id, v_overlap_tx
    FROM   recharge_requests rr
    WHERE  rr.student_id            = NEW.student_id
      AND  rr.status                = 'pending'
      AND  rr.paid_transaction_ids  && NEW.paid_transaction_ids   -- operador de solapamiento de arrays
      AND  (NEW.id IS NULL OR rr.id <> NEW.id)                   -- excluir el propio registro (UPDATE)
    GROUP  BY rr.id
    LIMIT  1;

    IF v_overlap_tx > 0 THEN
      RAISE EXCEPTION
        'DUPLICATE_PAYMENT: Los tickets seleccionados ya están incluidos en '
        'otro pago que está en revisión (solicitud %). '
        'Espera a que ese pago sea procesado antes de enviar uno nuevo. '
        'Si fue rechazado, recarga la página e intenta de nuevo.',
        v_conflicting_request_id;
    END IF;
  END IF;

  -- ── CANDADO 2: lunch_order_ids ────────────────────────────────────────────
  -- Bloquear si algún almuerzo ya está en un request PENDIENTE del mismo alumno
  IF COALESCE(cardinality(NEW.lunch_order_ids), 0) > 0 THEN
    SELECT rr.id, COUNT(*)
    INTO   v_conflicting_request_id, v_overlap_lunch
    FROM   recharge_requests rr
    WHERE  rr.student_id      = NEW.student_id
      AND  rr.status          = 'pending'
      AND  rr.lunch_order_ids && NEW.lunch_order_ids
      AND  (NEW.id IS NULL OR rr.id <> NEW.id)
    GROUP  BY rr.id
    LIMIT  1;

    IF v_overlap_lunch > 0 THEN
      RAISE EXCEPTION
        'DUPLICATE_PAYMENT: Algunos almuerzos seleccionados ya están incluidos en '
        'otro pago que está en revisión (solicitud %). '
        'Espera a que ese pago sea procesado antes de enviar uno nuevo. '
        'Si fue rechazado, recarga la página e intenta de nuevo.',
        v_conflicting_request_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Crear el trigger (BEFORE INSERT para que sea antes de tocar la tabla)
DROP TRIGGER IF EXISTS trg_check_no_overlapping_payment_ids ON recharge_requests;

CREATE TRIGGER trg_check_no_overlapping_payment_ids
  BEFORE INSERT ON recharge_requests
  FOR EACH ROW
  EXECUTE PROCEDURE fn_check_no_overlapping_payment_ids();

-- ── ÍNDICE: acelerar el chequeo de solapamiento ──────────────────────────────
-- El operador && sobre arrays usa GIN index
CREATE INDEX IF NOT EXISTS idx_rr_paid_tx_ids_gin
  ON recharge_requests USING GIN (paid_transaction_ids)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_rr_lunch_order_ids_gin
  ON recharge_requests USING GIN (lunch_order_ids)
  WHERE status = 'pending';

SELECT '✅ Candado anti-duplicados en recharge_requests instalado correctamente.' AS status;
