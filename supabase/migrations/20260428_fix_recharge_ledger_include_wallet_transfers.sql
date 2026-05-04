-- ============================================================================
-- FIX: view_recharge_ledger también debe descontar transferencias salientes
-- Fecha: 2026-04-28
--
-- Contexto:
--   Recargas (request_type='recharge') quedan asociadas a un student_id.
--   En pagos combinados (varios hijos) se reasigna saldo entre hijos mediante
--   wallet_transactions.type='manual_adjustment' (negativo en origen,
--   positivo en destino). El ledger debe reflejar esa "salida" como consumo
--   para que el saldo restante del alumno origen llegue a 0 cuando corresponde.
--
-- Solución:
--   Extender student_consumed para incluir:
--     wallet_transactions.amount < 0 AND type='manual_adjustment'
--   además de payment_debit (ya incluido en el fix anterior).
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.view_recharge_ledger AS
WITH
ranked_recharges AS (
  SELECT
    rr.id                                           AS recharge_request_id,
    rr.student_id,
    rr.parent_id,
    rr.school_id,
    rr.amount::numeric                              AS recharge_amount,
    rr.status                                       AS recharge_status,
    rr.request_type,
    rr.reference_code,
    rr.payment_method                               AS recharge_payment_method,
    rr.voucher_url,
    rr.created_at                                   AS recharge_created_at,
    rr.approved_at                                  AS recharge_approved_at,
    COALESCE(rr.approved_at, rr.created_at)         AS recharge_effective_at,
    av.id                                           AS auditoria_voucher_id,
    av.nro_operacion,
    av.monto_detectado,
    av.fecha_pago_detectada,
    av.estado_ia,
    av.subido_por                                   AS voucher_subido_por
  FROM public.recharge_requests rr
  LEFT JOIN LATERAL (
    SELECT av2.id, av2.nro_operacion, av2.monto_detectado,
           av2.fecha_pago_detectada, av2.estado_ia, av2.subido_por
    FROM   public.auditoria_vouchers av2
    WHERE  av2.id_cobranza = rr.id
    ORDER  BY COALESCE(av2.actualizado_at, av2.creado_at) DESC, av2.id DESC
    LIMIT  1
  ) av ON true
  WHERE rr.request_type = 'recharge'
    AND rr.status       = 'approved'
),

cumulative AS (
  SELECT
    rr.*,
    COALESCE(
      SUM(rr.recharge_amount) OVER (
        PARTITION BY rr.student_id
        ORDER BY rr.recharge_effective_at ASC, rr.recharge_request_id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0
    )                                               AS cum_before,
    SUM(rr.recharge_amount) OVER (
      PARTITION BY rr.student_id
      ORDER BY rr.recharge_effective_at ASC, rr.recharge_request_id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )                                               AS cum_after
  FROM ranked_recharges rr
),

student_consumed AS (
  SELECT
    x.student_id,
    COALESCE(SUM(x.consumed_amount), 0)::numeric AS total_consumed
  FROM (
    -- Kiosco / POS
    SELECT
      t.student_id,
      COALESCE(SUM(ABS(t.amount)), 0)::numeric AS consumed_amount
    FROM public.transactions t
    WHERE t.student_id                     IS NOT NULL
      AND t.type                           = 'purchase'
      AND t.is_deleted                     = false
      AND t.payment_status                 = 'paid'
      AND (t.metadata->>'lunch_order_id')  IS NULL
      AND t.amount                         < 0
    GROUP BY t.student_id

    UNION ALL

    -- Débitos de billetera (uso real del saldo)
    SELECT
      wt.student_id,
      COALESCE(SUM(ABS(wt.amount)), 0)::numeric AS consumed_amount
    FROM public.wallet_transactions wt
    WHERE wt.student_id IS NOT NULL
      AND wt.type = 'payment_debit'
      AND wt.amount < 0
    GROUP BY wt.student_id

    UNION ALL

    -- Transferencias salientes de saldo (reasignación entre hermanos)
    SELECT
      wt.student_id,
      COALESCE(SUM(ABS(wt.amount)), 0)::numeric AS consumed_amount
    FROM public.wallet_transactions wt
    WHERE wt.student_id IS NOT NULL
      AND wt.type = 'manual_adjustment'
      AND wt.amount < 0
    GROUP BY wt.student_id
  ) x
  GROUP BY x.student_id
),

ledger AS (
  SELECT
    c.*,
    COALESCE(sc.total_consumed, 0)                  AS consumed_total_student,
    GREATEST(0,
      LEAST(COALESCE(sc.total_consumed, 0), c.cum_after) - c.cum_before
    )::numeric                                      AS consumed_from_this_recharge
  FROM cumulative c
  LEFT JOIN student_consumed sc ON sc.student_id = c.student_id
)

SELECT
  l.recharge_request_id,
  l.auditoria_voucher_id,
  l.student_id,
  l.parent_id,
  l.school_id,

  l.recharge_status,
  l.request_type,
  l.reference_code,
  l.recharge_payment_method,
  l.voucher_url,

  l.nro_operacion,
  l.monto_detectado,
  l.fecha_pago_detectada,
  l.estado_ia,
  l.voucher_subido_por,

  l.recharge_created_at,
  l.recharge_approved_at,
  l.recharge_effective_at,

  l.recharge_amount,
  l.consumed_from_this_recharge,
  GREATEST(0, l.recharge_amount - l.consumed_from_this_recharge)::numeric  AS recharge_remaining,

  l.consumed_total_student,

  SUM(GREATEST(0, l.recharge_amount - l.consumed_from_this_recharge))
    OVER (PARTITION BY l.student_id)::numeric       AS recharge_remaining_student

FROM ledger l;

COMMENT ON VIEW public.view_recharge_ledger
IS 'SSOT del Monedero de Recargas. Calcula saldo disponible por alumno con FIFO. '
   'Incluye consumo POS + wallet_transactions.payment_debit + transferencias salientes (manual_adjustment negativas). '
   'NO modifica tablas. El frontend es espejo pasivo.';

COMMIT;

