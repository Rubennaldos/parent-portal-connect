-- ============================================================================
-- 2026-04-27 — get_parent_debts_v2: no mostrar almuerzo_virtual si ya hay pago
--              paid cuyo lunch_metadata_repair_prior_lunch_order_id = pedido
--
-- CONTEXTO:
--   Tras reparar metadata (20260424), la compra paid apunta al pedido nuevo
--   pero deja prior = pedido viejo. El tramo 2 solo miraba lunch_order_id
--   actual → NOT EXISTS true → deuda virtual duplicada para el 22/04.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_parent_debts_v2(uuid);

CREATE OR REPLACE FUNCTION public.get_parent_debts_v2(p_parent_id uuid)
RETURNS TABLE(
  deuda_id                 text,
  student_id               uuid,
  school_id                uuid,
  monto                    numeric,
  descripcion              text,
  fecha                    timestamptz,
  fuente                   text,
  es_almuerzo              boolean,
  metadata                 jsonb,
  ticket_code              text,
  voucher_status           text,
  voucher_request_id       uuid,
  voucher_rejection_reason text,
  summary_total_bruto      numeric,
  summary_in_review        numeric,
  summary_neto_payable     numeric,
  summary_student_total     numeric,
  summary_student_payable   numeric,
  summary_student_in_review numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN RETURN; END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red')
    AND v_caller_id <> p_parent_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  student_ids AS (
    SELECT s.id AS sid, s.school_id AS s_school_id, s.balance AS s_balance
    FROM   public.students s
    WHERE  s.parent_id = p_parent_id
      AND  s.is_active = true
  ),

  debts_raw AS (

    SELECT
      t.id::text                                              AS deuda_id,
      t.student_id                                            AS student_id,
      t.school_id                                             AS school_id,
      ABS(t.amount)::numeric(10,2)                            AS monto,
      COALESCE(t.description, 'Deuda sin descripción')        AS descripcion,
      t.created_at                                            AS fecha,
      'transaccion'::text                                     AS fuente,
      ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS es_almuerzo,
      t.metadata                                              AS metadata,
      t.ticket_code                                           AS ticket_code
    FROM public.transactions t
    WHERE t.student_id IN (SELECT sid FROM student_ids)
      AND t.type           = 'purchase'
      AND t.is_deleted     = false
      AND t.payment_status IN ('pending', 'partial')

    UNION ALL

    SELECT
      ('lunch_' || lo.id::text)::text                         AS deuda_id,
      lo.student_id                                           AS student_id,
      COALESCE(lo.school_id, si.s_school_id)                  AS school_id,
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
    JOIN student_ids si ON si.sid = lo.student_id
    LEFT JOIN public.lunch_categories lc
           ON lc.id = lo.category_id
    LEFT JOIN public.lunch_configuration lcfg
           ON lcfg.school_id = COALESCE(lo.school_id, si.s_school_id)
    WHERE lo.is_cancelled = false
      AND lo.status NOT IN ('cancelled')
      AND NOT EXISTS (
        SELECT 1
        FROM   public.transactions t2
        WHERE  t2.is_deleted     = false
          AND  t2.student_id     = lo.student_id
          AND  t2.payment_status IN ('pending', 'partial', 'paid', 'cancelled')
          AND  (
            (t2.metadata->>'lunch_order_id') = lo.id::text
            OR
            (t2.metadata ? 'original_lunch_ids'
             AND t2.metadata->'original_lunch_ids' @> to_jsonb(ARRAY[lo.id::text]))
            OR
            (
              t2.type = 'purchase'
              AND t2.payment_status = 'paid'
              AND NULLIF(t2.metadata->>'lunch_metadata_repair_prior_lunch_order_id', '')
                = lo.id::text
            )
          )
      )

    UNION ALL

    SELECT
      ('kiosk_balance_' || si.sid::text)::text                AS deuda_id,
      si.sid                                                  AS student_id,
      si.s_school_id                                          AS school_id,
      ABS(si.s_balance)::numeric(10,2)                        AS monto,
      'Deuda en kiosco (saldo negativo)'::text                 AS descripcion,
      NOW()                                                   AS fecha,
      'saldo_negativo'::text                                  AS fuente,
      false                                                   AS es_almuerzo,
      jsonb_build_object(
        'is_kiosk_balance_debt', true,
        'balance', si.s_balance
      )                                                       AS metadata,
      NULL::text                                              AS ticket_code
    FROM student_ids si
    WHERE si.s_balance < 0
      AND NOT EXISTS (
        SELECT 1
        FROM   public.transactions t3
        WHERE  t3.student_id     = si.sid
          AND  t3.type           = 'purchase'
          AND  t3.is_deleted     = false
          AND  t3.payment_status IN ('pending', 'partial')
          AND  (t3.metadata->>'lunch_order_id') IS NULL
      )
  ),

  debts_base AS (
    SELECT
      dr.*,
      CASE WHEN dr.fuente = 'transaccion'
        THEN dr.deuda_id::uuid ELSE NULL::uuid
      END AS deuda_tx_uuid,
      CASE WHEN dr.fuente = 'almuerzo_virtual'
        THEN (dr.metadata->>'lunch_order_id')::uuid ELSE NULL::uuid
      END AS lunch_uuid
    FROM debts_raw dr
  ),

  debts_with_voucher AS (
    SELECT
      db.deuda_id,
      db.student_id,
      db.school_id,
      db.monto,
      db.descripcion,
      db.fecha,
      db.fuente,
      db.es_almuerzo,
      db.metadata,
      db.ticket_code,
      rr_match.status           AS voucher_status,
      rr_match.id               AS voucher_request_id,
      rr_match.rejection_reason AS voucher_rejection_reason
    FROM debts_base db
    LEFT JOIN LATERAL (
      SELECT rr.id, rr.status, rr.rejection_reason
      FROM   public.recharge_requests rr
      WHERE  rr.parent_id = p_parent_id
        AND  rr.status    IN ('pending', 'rejected')
        AND  (
          (db.deuda_tx_uuid IS NOT NULL
           AND rr.paid_transaction_ids IS NOT NULL
           AND db.deuda_tx_uuid = ANY(rr.paid_transaction_ids))
          OR
          (db.lunch_uuid IS NOT NULL
           AND rr.lunch_order_ids IS NOT NULL
           AND db.lunch_uuid = ANY(rr.lunch_order_ids))
          OR
          (db.fuente = 'saldo_negativo'
           AND rr.student_id = db.student_id
           AND rr.request_type IN ('debt_payment', 'recharge'))
        )
      ORDER BY rr.created_at DESC
      LIMIT 1
    ) rr_match ON true
  )

  SELECT
    dv.deuda_id,
    dv.student_id,
    dv.school_id,
    dv.monto,
    dv.descripcion,
    dv.fecha,
    dv.fuente,
    dv.es_almuerzo,
    dv.metadata,
    dv.ticket_code,
    dv.voucher_status,
    dv.voucher_request_id,
    dv.voucher_rejection_reason,
    SUM(dv.monto) OVER ()
      AS summary_total_bruto,
    SUM(CASE WHEN dv.voucher_status = 'pending' THEN dv.monto ELSE 0 END) OVER ()
      AS summary_in_review,
    SUM(CASE WHEN (dv.voucher_status IS DISTINCT FROM 'pending') THEN dv.monto ELSE 0 END) OVER ()
      AS summary_neto_payable,
    SUM(dv.monto) OVER (PARTITION BY dv.student_id)
      AS summary_student_total,
    SUM(CASE WHEN (dv.voucher_status IS DISTINCT FROM 'pending') THEN dv.monto ELSE 0 END) OVER (PARTITION BY dv.student_id)
      AS summary_student_payable,
    SUM(CASE WHEN dv.voucher_status = 'pending' THEN dv.monto ELSE 0 END) OVER (PARTITION BY dv.student_id)
      AS summary_student_in_review
  FROM debts_with_voucher dv
  ORDER BY dv.fecha DESC;

END;
$$;

COMMENT ON FUNCTION public.get_parent_debts_v2(uuid) IS
  'v3.1 2026-04-27 — Igual v3.0 + tramo almuerzo_virtual: NOT EXISTS también si '
  'hay purchase paid del mismo alumno con lunch_metadata_repair_prior_lunch_order_id = lo.id '
  '(evita deuda fantasma tras 20260424).';

SELECT 'get_parent_debts_v2 v3.1 — almuerzo_virtual coherente con repair_prior' AS resultado;
