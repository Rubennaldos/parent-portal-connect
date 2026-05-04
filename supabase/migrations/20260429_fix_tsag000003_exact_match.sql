-- ============================================================================
-- Reparación quirúrgica T-SAG-000003
-- Solo actúa si existe un crédito IziPay con el MISMO monto exacto (±S/0.01)
-- para el mismo alumno. Sin tolerancia alguna.
-- Si no hay crédito exacto, el UPDATE no toca nada (la deuda sigue pendiente y
-- el padre debe pagarla).
-- ============================================================================

WITH target_debt AS (
  SELECT t.id, t.student_id, t.amount
  FROM   public.transactions t
  WHERE  t.ticket_code       = 'T-SAG-000003'
    AND  t.type              = 'purchase'
    AND  t.payment_status    IN ('pending', 'partial')
    AND  t.is_deleted        IS DISTINCT FROM TRUE
  LIMIT 1
),
matching_izipay_credit AS (
  SELECT t.id AS credit_id, td.id AS debt_id
  FROM   target_debt td
  JOIN   public.transactions t
         ON  t.student_id    = td.student_id
         AND t.type          = 'recharge'
         AND t.payment_status = 'paid'
         AND t.is_deleted    IS DISTINCT FROM TRUE
         AND (
               (t.metadata->>'source')       = 'gateway_webhook'
            OR (t.metadata->>'gateway_name') = 'izipay'
            OR  t.gateway_reference_id       IS NOT NULL
         )
         AND ABS(t.amount - ABS(td.amount)) < 0.01   -- coincidencia exacta, sin margen
)
UPDATE public.transactions t
SET
  payment_status = 'paid',
  payment_method = COALESCE(t.payment_method, 'card'),
  metadata       = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'repaired_by', '20260429_fix_tsag000003_exact_match',
    'repaired_at', NOW()
  )
FROM matching_izipay_credit mc
WHERE t.id = mc.debt_id
RETURNING t.id, t.ticket_code, t.payment_status AS new_status;
