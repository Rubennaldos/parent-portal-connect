-- ============================================================================
-- 2026-04-23 — Dos correcciones arquitectónicas:
--
-- A) view_student_debts Tramo 2: Bug "ghost debt" (deuda fantasma)
--    Problema: Si una transacción de almuerzo fue CANCELADA por el admin
--    (payment_status = 'cancelled'), el NOT EXISTS del Tramo 2 devolvía TRUE
--    y el lunch_order reaparecía como "almuerzo_virtual" en la vista.
--    El padre seguía viendo el almuerzo como deuda pendiente aunque el admin
--    ya lo había cancelado.
--
--    Fix: Agregar 'cancelled' al payment_status IN (...) del NOT EXISTS para
--    que un almuerzo cuya transacción fue cancelada explícitamente no aparezca
--    como nueva deuda virtual.
--
-- B) get_student_recharge_ledger: incluir pending_total en el JSON
--    Problema: BalanceSaldoModal.tsx calculaba con .reduce() la suma de los
--    recharge_requests pendientes (violación Regla 11.A: Cero Cálculos en
--    el Cliente). El RPC devuelve las filas pero el total lo calculaba React.
--
--    Fix: Calcular SUM(amount) de los pendientes en PostgreSQL y devolverlo
--    como pending_total en el JSON del RPC.
-- ============================================================================

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- A) Corrección de view_student_debts — Bug "ghost debt"
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP VIEW IF EXISTS public.view_student_debts CASCADE;

CREATE VIEW public.view_student_debts AS
-- Tramo 1: compras con deuda
SELECT
  t.id::text                                              AS deuda_id,
  t.student_id                                            AS student_id,
  t.teacher_id                                            AS teacher_id,
  t.manual_client_name::text                              AS manual_client_name,
  t.school_id                                             AS school_id,
  ABS(t.amount)::numeric(10,2)                            AS monto,
  COALESCE(t.description, 'Deuda sin descripción')        AS descripcion,
  t.created_at                                            AS fecha,
  'transaccion'::text                                     AS fuente,
  ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS es_almuerzo,
  t.metadata                                              AS metadata,
  t.ticket_code                                           AS ticket_code
FROM public.transactions t
WHERE t.type           = 'purchase'
  AND t.is_deleted     = false
  AND t.payment_status IN ('pending', 'partial')
UNION ALL
-- Tramo 2: almuerzos sin registro de compra (o cuyo pago vive solo en split fiscal)
-- FIX 2026-04-23: Se añade 'cancelled' al payment_status IN del NOT EXISTS.
-- Antes solo excluía (pending, partial, paid); si el admin cancelaba la transacción
-- (payment_status='cancelled') el lunch_order reaparecía como deuda virtual.
-- Ahora también se excluye si la transacción fue cancelada explícitamente.
SELECT
  ('lunch_' || lo.id::text)::text                         AS deuda_id,
  lo.student_id                                           AS student_id,
  lo.teacher_id                                           AS teacher_id,
  lo.manual_name::text                                    AS manual_client_name,
  COALESCE(lo.school_id, st.school_id, tp.school_id_1)   AS school_id,
  ABS(ROUND(
    CASE
      WHEN lo.final_price IS NOT NULL AND lo.final_price > 0
        THEN lo.final_price
      WHEN lc.price IS NOT NULL AND lc.price > 0
        THEN lc.price * COALESCE(lo.quantity, 1)
      WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
        THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
      ELSE 7.50 * COALESCE(lo.quantity, 1)
    END, 2
  ))::numeric(10,2)                                       AS monto,
  (
    'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
    CASE WHEN COALESCE(lo.quantity, 1) > 1
      THEN ' (' || lo.quantity::text || 'x)' ELSE '' END ||
    ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
  )::text                                                 AS descripcion,
  (lo.order_date::date + interval '12 hours')::timestamptz AS fecha,
  'almuerzo_virtual'::text                                AS fuente,
  true                                                    AS es_almuerzo,
  jsonb_build_object(
    'lunch_order_id', lo.id::text,
    'source',         'lunch_order',
    'order_date',     lo.order_date
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code
FROM public.lunch_orders lo
LEFT JOIN public.students         st   ON st.id  = lo.student_id
LEFT JOIN public.teacher_profiles tp   ON tp.id  = lo.teacher_id
LEFT JOIN public.lunch_categories lc   ON lc.id  = lo.category_id
LEFT JOIN public.lunch_configuration lcfg ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
WHERE lo.is_cancelled = false
  AND lo.status NOT IN ('cancelled')
  AND NOT EXISTS (
    SELECT 1
    FROM   public.transactions t2
    WHERE  t2.is_deleted     = false
      -- FIX: 'cancelled' añadido — un almuerzo con transacción cancelada por
      -- el admin NO debe reaparecer como nueva deuda virtual.
      AND  t2.payment_status IN ('pending', 'partial', 'paid', 'cancelled')
      AND  (
        (t2.metadata->>'lunch_order_id') = lo.id::text
        OR
        (t2.metadata ? 'original_lunch_ids' AND t2.metadata->'original_lunch_ids' @> to_jsonb(ARRAY[lo.id::text]))
      )
  )
UNION ALL
-- Tramo 3: saldo kiosco negativo sin deuda pendiente explícita
SELECT
  ('kiosk_balance_' || s.id::text)::text                  AS deuda_id,
  s.id                                                    AS student_id,
  NULL::uuid                                              AS teacher_id,
  NULL::text                                              AS manual_client_name,
  s.school_id                                             AS school_id,
  ABS(s.balance)::numeric(10,2)                           AS monto,
  'Deuda en kiosco (saldo negativo)'::text                 AS descripcion,
  NOW()                                                   AS fecha,
  'saldo_negativo'::text                                  AS fuente,
  false                                                   AS es_almuerzo,
  jsonb_build_object(
    'is_kiosk_balance_debt', true,
    'balance',               s.balance
  )                                                       AS metadata,
  NULL::text                                              AS ticket_code
FROM public.students s
WHERE s.balance   < 0
  AND s.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM   public.transactions t3
    WHERE  t3.student_id     = s.id
      AND  t3.type           = 'purchase'
      AND  t3.is_deleted     = false
      AND  t3.payment_status IN ('pending', 'partial')
      AND  (t3.metadata->>'lunch_order_id') IS NULL
  );

GRANT SELECT ON public.view_student_debts TO authenticated, service_role;

SELECT 'FIX A OK: view_student_debts Tramo 2 — ghost debt eliminado (cancelled añadido al NOT EXISTS)' AS resultado;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- B) get_student_recharge_ledger: añadir pending_total (Regla 11.A)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
  v_pending_total   numeric := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN jsonb_build_object(
      'ledger',          '[]'::jsonb,
      'pending',         '[]'::jsonb,
      'total_remaining', 0,
      'pending_total',   0
    );
  END IF;

  -- ── 1) Recargas del ledger con código REC-XXX ─────────────────────────────
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
      ORDER BY sub.rn DESC
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

  -- ── 2) Recargas pendientes ("dinero en el aire") + su total ───────────────
  -- El total se calcula en la DB (Regla 11.A: Cero Cálculos en el Cliente).
  SELECT
    COALESCE(
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
    ),
    COALESCE(SUM(rr.amount), 0)
  INTO v_pending, v_pending_total
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
    'total_remaining', v_total_remaining,
    'pending_total',   v_pending_total
  );
END;
$fn$;

COMMENT ON FUNCTION public.get_student_recharge_ledger(uuid)
IS '2026-04-23 — Monedero de Recargas. Devuelve JSON con recargas (REC-XXX + FIFO), '
   'pendientes, pending_total (suma DB, Regla 11.A: Cero Cálculos en el Cliente) y saldo total. '
   'SSOT: view_recharge_ledger. No modifica tablas.';

SELECT 'FIX B OK: get_student_recharge_ledger incluye pending_total calculado en DB' AS resultado;
