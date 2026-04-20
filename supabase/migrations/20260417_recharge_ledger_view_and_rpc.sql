-- ============================================================================
-- MÓDULO: Monedero de Recargas
--
-- Entregables:
--   1. VIEW  view_recharge_ledger      → cálculo FIFO de consumo por recarga
--   2. RPC   get_student_recharge_ledger → datos listos para el modal (JSON)
--
-- REGLAS (inscriptas en .cursorrules y reglas-de-oro.mdc):
--   11.A  Todo cálculo FIFO vive aquí, no en React
--   11.C  Reloj único: timezone('America/Lima', now())
--   Ley 7 El frontend solo "pinta" lo que esta vista/RPC devuelve
--
-- LEY DE PRESERVACIÓN:
--   No se toca alumnos.saldo_actual ni students.balance.
--   Este módulo lee y calcula; nunca escribe.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) VISTA: view_recharge_ledger
--    SSOT para el saldo disponible de recargas con respaldo de voucher.
--    Lógica FIFO: la recarga más antigua se consume primero.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.view_recharge_ledger CASCADE;

CREATE VIEW public.view_recharge_ledger AS
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

-- C) Consumo real del alumno en kiosco (compras POS pagadas, sin almuerzos)
student_consumed AS (
  SELECT
    t.student_id,
    COALESCE(SUM(ABS(t.amount)), 0)::numeric        AS total_consumed
  FROM public.transactions t
  WHERE t.student_id                IS NOT NULL
    AND t.type                      = 'purchase'
    AND t.is_deleted                = false
    AND t.payment_status            = 'paid'
    AND (t.metadata->>'lunch_order_id') IS NULL
    AND t.amount                    < 0            -- compras POS son negativas
  GROUP BY t.student_id
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
   'NO modifica tablas. El frontend es un espejo pasivo de esta vista.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RPC: get_student_recharge_ledger
--    Devuelve JSON listo para el modal:
--      ledger          → recargas con código REC-XXX, consumo y saldo restante
--      pending         → recargas aún no aprobadas ("dinero en el aire")
--      total_remaining → saldo disponible total (suma de recharge_remaining_student)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_student_recharge_ledger(
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ledger          jsonb;
  v_pending         jsonb;
  v_total_remaining numeric := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN jsonb_build_object(
      'ledger',          '[]'::jsonb,
      'pending',         '[]'::jsonb,
      'total_remaining', 0
    );
  END IF;

  -- ── 1) Recargas del ledger con código REC-XXX ─────────────────────────────
  -- El número del código se asigna por antigüedad: la más vieja = REC-001.
  -- El listado se ordena descendente (más reciente primero) para el modal.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'rec_code',            'REC-' || LPAD(sub.rn::text, 3, '0'),
        'recharge_request_id', sub.recharge_request_id,
        'recharge_amount',     sub.recharge_amount,
        'consumed',            sub.consumed_from_this_recharge,
        'remaining',           sub.recharge_remaining,
        'effective_at',        sub.recharge_effective_at,
        'status',              sub.recharge_status,
        'nro_operacion',       sub.nro_operacion,
        'payment_method',      sub.recharge_payment_method
      )
      ORDER BY sub.rn DESC    -- más reciente primero en la UI
    ),
    '[]'::jsonb
  )
  INTO v_ledger
  FROM (
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY vrl.recharge_effective_at ASC, vrl.recharge_request_id ASC
      )                                     AS rn,
      vrl.recharge_request_id,
      vrl.recharge_amount,
      vrl.consumed_from_this_recharge,
      vrl.recharge_remaining,
      vrl.recharge_effective_at,
      vrl.recharge_status,
      vrl.nro_operacion,
      vrl.recharge_payment_method
    FROM public.view_recharge_ledger vrl
    WHERE vrl.student_id = p_student_id
  ) sub;

  -- ── 2) Recargas pendientes ("dinero en el aire") ───────────────────────────
  -- NO se suman al saldo disponible hasta ser aprobadas.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',             rr.id,
        'amount',         rr.amount,
        'payment_method', rr.payment_method,
        'reference_code', rr.reference_code,
        'created_at',     rr.created_at
      )
      ORDER BY rr.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_pending
  FROM public.recharge_requests rr
  WHERE rr.student_id   = p_student_id
    AND rr.request_type = 'recharge'
    AND rr.status       = 'pending';

  -- ── 3) Total restante (saldo disponible consolidado) ──────────────────────
  SELECT COALESCE(
    (SELECT MAX(vrl2.recharge_remaining_student)
     FROM   public.view_recharge_ledger vrl2
     WHERE  vrl2.student_id = p_student_id),
    0
  ) INTO v_total_remaining;

  RETURN jsonb_build_object(
    'ledger',          v_ledger,
    'pending',         v_pending,
    'total_remaining', v_total_remaining
  );
END;
$fn$;

COMMENT ON FUNCTION public.get_student_recharge_ledger(uuid)
IS 'Monedero de Recargas — entrega JSON con recargas (REC-XXX + FIFO), pendientes y saldo total. '
   'SSOT: view_recharge_ledger. No modifica tablas. El 0 del ledger es la verdad financiera.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Verificación: alumno "dddddd" como prueba de humo
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.get_student_recharge_ledger(
  (SELECT id FROM public.students WHERE full_name ILIKE '%dddddd%' LIMIT 1)
);

COMMIT;
