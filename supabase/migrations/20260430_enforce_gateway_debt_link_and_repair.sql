-- ============================================================================
-- HARDENING IziPay: exigir vínculo deuda/ticket en pagos de deuda + reparación
-- Fecha: 2026-04-30
--
-- Objetivos:
-- 1) Evitar que vuelva a existir payment_session de deuda/almuerzo con debt_tx_ids vacío.
-- 2) Reparar sesiones históricas de IziPay (success + debt_tx_ids=[]) vinculando
--    una deuda pending compatible del mismo alumno (tolerancia monto ±S/1.00).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) payment_sessions.request_type (si no existe)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS request_type text;

UPDATE public.payment_sessions
SET request_type = CASE
  WHEN COALESCE(cardinality(debt_tx_ids), 0) > 0 THEN 'debt_payment'
  ELSE 'recharge'
END
WHERE request_type IS NULL;

ALTER TABLE public.payment_sessions
  DROP CONSTRAINT IF EXISTS payment_sessions_request_type_check;

ALTER TABLE public.payment_sessions
  ADD CONSTRAINT payment_sessions_request_type_check
  CHECK (request_type IN ('recharge', 'debt_payment', 'lunch_payment'));

ALTER TABLE public.payment_sessions
  ALTER COLUMN request_type SET DEFAULT 'recharge';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Guard DB: no permitir debt_payment/lunch_payment con debt_tx_ids vacío
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_payment_sessions_debt_ids()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.gateway_name, '') = 'izipay'
     AND COALESCE(NEW.request_type, 'recharge') IN ('debt_payment', 'lunch_payment')
     AND COALESCE(cardinality(NEW.debt_tx_ids), 0) = 0
  THEN
    RAISE EXCEPTION
      'VALIDATION_ERROR: debt_tx_ids requerido para request_type=% en IziPay',
      NEW.request_type;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payment_sessions_debt_ids ON public.payment_sessions;
CREATE TRIGGER trg_guard_payment_sessions_debt_ids
BEFORE INSERT OR UPDATE ON public.payment_sessions
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_payment_sessions_debt_ids();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Reparación histórica (autovincular sesiones huérfanas compatibles)
--    Regla: success + debt_tx_ids vacío, busca una deuda pending purchase
--    del mismo alumno con diferencia de monto <= 1 sol.
--    Prioridad: menor diferencia, luego deuda más antigua.
-- ─────────────────────────────────────────────────────────────────────────────
WITH orphan_sessions AS (
  SELECT
    ps.id               AS session_id,
    ps.student_id,
    ps.gateway_reference,
    ps.gateway_amount,
    ps.created_at       AS session_created_at
  FROM public.payment_sessions ps
  WHERE ps.gateway_name = 'izipay'
    AND ps.gateway_status::text = 'success'
    AND ps.status::text = 'completed'
    AND COALESCE(cardinality(ps.debt_tx_ids), 0) = 0
    AND COALESCE(ps.gateway_amount, 0) > 0
),
candidate_debts AS (
  SELECT
    os.session_id,
    os.gateway_reference,
    t.id                AS debt_tx_id,
    ABS(ABS(COALESCE(t.amount, 0)) - os.gateway_amount) AS diff_amount,
    t.created_at        AS debt_created_at,
    ROW_NUMBER() OVER (
      PARTITION BY os.session_id
      ORDER BY
        ABS(ABS(COALESCE(t.amount, 0)) - os.gateway_amount) ASC,
        t.created_at ASC
    ) AS rn_session
  FROM orphan_sessions os
  JOIN public.transactions t
    ON t.student_id = os.student_id
   AND t.type = 'purchase'
   AND t.payment_status = 'pending'
   AND t.is_deleted IS DISTINCT FROM TRUE
   AND ABS(ABS(COALESCE(t.amount, 0)) - os.gateway_amount) <= 1.00
),
best_per_session AS (
  SELECT
    session_id,
    gateway_reference,
    debt_tx_id,
    diff_amount,
    ROW_NUMBER() OVER (
      PARTITION BY debt_tx_id
      ORDER BY session_id
    ) AS rn_debt
  FROM candidate_debts
  WHERE rn_session = 1
),
matches AS (
  SELECT session_id, gateway_reference, debt_tx_id, diff_amount
  FROM best_per_session
  WHERE rn_debt = 1
),
upd_sessions AS (
  UPDATE public.payment_sessions ps
  SET
    debt_tx_ids = ARRAY[m.debt_tx_id],
    request_type = CASE
      WHEN COALESCE(ps.request_type, 'recharge') = 'recharge' THEN 'debt_payment'
      ELSE ps.request_type
    END
  FROM matches m
  WHERE ps.id = m.session_id
  RETURNING ps.id AS session_id, m.debt_tx_id, m.gateway_reference
),
upd_debts AS (
  UPDATE public.transactions t
  SET
    payment_status = 'paid',
    payment_method = COALESCE(t.payment_method, 'card'),
    metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'auto_linked_by', '20260430_enforce_gateway_debt_link_and_repair',
      'auto_linked_at', NOW(),
      'auto_linked_gateway_ref', us.gateway_reference
    )
  FROM upd_sessions us
  WHERE t.id = us.debt_tx_id
    AND t.payment_status = 'pending'
  RETURNING t.id
)
SELECT
  (SELECT COUNT(*) FROM upd_sessions) AS sessions_repaired,
  (SELECT COUNT(*) FROM upd_debts)    AS debts_marked_paid;

