-- ============================================================================
-- FIX: view_recharge_ledger debe descontar débitos de billetera
-- Fecha: 2026-04-28
--
-- Problema:
--   El "Saldo de Recargas" (SSOT: view_recharge_ledger) solo descuenta consumo
--   de kiosco (transactions purchase paid negativas, sin lunch_order_id).
--   En conciliaciones (huérfanos de almuerzo) se puede aplicar saldo a favor
--   vía wallet_transactions (type='payment_debit') sin que exista consumo de
--   kiosco (p.ej. alumno con kiosk_disabled = true). La UI quedaba mostrando
--   saldo completo aunque ya se descontó internamente.
--
-- Solución:
--   Mantener la regla de oro (almuerzos no descuentan recargas), pero hacer que
--   el ledger también considere los débitos reales de billetera:
--     wallet_transactions.amount < 0 AND type='payment_debit'
--   Esto NO agrega cálculos en frontend: la UI sigue siendo espejo pasivo.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.view_recharge_ledger AS
WITH
-- A) Recargas aprobadas con info del voucher (LEFT JOIN: aparece aunque no tenga auditoria)
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
    -- Voucher más reciente vinculado (puede ser NULL si no pasó por IA)
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
    AND rr.status       = 'approved'   -- solo recargas aprobadas cuentan para el saldo
),

-- B) Acumulado FIFO por alumno (más antigua = número más bajo = se consume primero)
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

-- C) Consumo real del alumno:
--    - Kiosco: compras POS pagadas (negativas), sin almuerzos
--    - Billetera: débitos reales registrados en wallet_transactions (payment_debit)
student_consumed AS (
  SELECT
    x.student_id,
    COALESCE(SUM(x.consumed_amount), 0)::numeric AS total_consumed
  FROM (
    -- Kiosco / POS (la lógica original del ledger)
    SELECT
      t.student_id,
      COALESCE(SUM(ABS(t.amount)), 0)::numeric AS consumed_amount
    FROM public.transactions t
    WHERE t.student_id                     IS NOT NULL
      AND t.type                           = 'purchase'
      AND t.is_deleted                     = false
      AND t.payment_status                 = 'paid'
      AND (t.metadata->>'lunch_order_id')  IS NULL
      AND t.amount                         < 0            -- compras POS son negativas
    GROUP BY t.student_id

    UNION ALL

    -- Débitos de billetera (incluye conciliaciones u otros usos del saldo a favor)
    SELECT
      wt.student_id,
      COALESCE(SUM(ABS(wt.amount)), 0)::numeric AS consumed_amount
    FROM public.wallet_transactions wt
    WHERE wt.student_id IS NOT NULL
      AND wt.type = 'payment_debit'
      AND wt.amount < 0
    GROUP BY wt.student_id
  ) x
  GROUP BY x.student_id
),

-- D) Asignación FIFO: cuánto consumió cada recarga
ledger AS (
  SELECT
    c.*,
    COALESCE(sc.total_consumed, 0)                  AS consumed_total_student,
    -- Porción de consumo que "cae" sobre esta recarga específica (FIFO)
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

  -- Saldo total disponible del alumno (misma cifra en todas las filas del mismo alumno)
  SUM(GREATEST(0, l.recharge_amount - l.consumed_from_this_recharge))
    OVER (PARTITION BY l.student_id)::numeric       AS recharge_remaining_student

FROM ledger l;

COMMENT ON VIEW public.view_recharge_ledger
IS 'SSOT del Monedero de Recargas. Calcula saldo disponible por alumno con lógica FIFO. '
   'Incluye consumo de kiosco (transactions POS) y débitos reales de billetera (wallet_transactions.payment_debit). '
   'NO modifica tablas. El frontend es un espejo pasivo de esta vista.';

COMMIT;

