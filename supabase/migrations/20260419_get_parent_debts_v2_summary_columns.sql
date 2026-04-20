-- ============================================================================
-- MIGRACIÓN: get_parent_debts_v2 → v2.1 (summary columns)
-- Fecha: 2026-04-19
--
-- PROBLEMA QUE RESUELVE:
--   El frontend calculaba totalDebt, totalPayable y totalInReview con .reduce()
--   sobre los datos ya recibidos del RPC. Esto viola la Ley de No-Cálculo:
--   cualquier suma financiera debe vivir en SQL, no en TypeScript.
--
-- SOLUCIÓN:
--   Añadir 3 columnas de resumen al RETURN TABLE calculadas con window functions
--   (SUM(...) OVER()) en la misma query. El valor es idéntico en cada fila:
--   el frontend solo lee los campos del primer registro.
--
--   · summary_total_bruto   → SUM de todas las deudas del padre
--   · summary_in_review     → SUM de deudas cubiertas por voucher 'pending'
--   · summary_neto_payable  → summary_total_bruto - summary_in_review
--
-- REGLA DE NO-CÁLCULO (Arquisia):
--   El frontend NUNCA debe sumar ni restar montos de deudas.
--   Recibe números finales del servidor y los pinta.
-- ============================================================================

-- DROP obligatorio: PostgreSQL no permite cambiar el tipo de retorno con CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.get_parent_debts_v2(uuid);

CREATE OR REPLACE FUNCTION public.get_parent_debts_v2(p_parent_id uuid)
RETURNS TABLE(
  -- ── Columnas originales (sin cambios — retrocompatible) ─────────────────
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
  -- ── NUEVAS columnas de resumen (v2.1) ───────────────────────────────────
  -- Repetidas en cada fila; el frontend lee solo la primera.
  summary_total_bruto      numeric,  -- suma de TODAS las deudas del padre
  summary_in_review        numeric,  -- suma de las deudas con voucher 'pending'
  summary_neto_payable     numeric   -- total_bruto - in_review (lo que el padre debe pagar)
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

  SELECT role INTO v_caller_role
  FROM   profiles
  WHERE  id = v_caller_id;

  -- Padres solo pueden ver sus propios hijos
  IF v_caller_role NOT IN ('admin_general', 'gestor_unidad', 'superadmin', 'supervisor_red')
    AND v_caller_id <> p_parent_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  -- ── A) IDs de alumnos activos del padre ─────────────────────────────────
  student_ids AS (
    SELECT s.id AS sid
    FROM   students s
    WHERE  s.parent_id = p_parent_id
      AND  s.is_active = true
  ),

  -- ── B) Deudas base + UUID-cast SEGURO por tramo ──────────────────────────
  debts_base AS (
    SELECT
      vsd.*,
      CASE WHEN vsd.fuente = 'transaccion'
        THEN vsd.deuda_id::uuid
        ELSE NULL::uuid
      END                                           AS deuda_tx_uuid,
      CASE WHEN vsd.fuente = 'almuerzo_virtual'
        THEN (vsd.metadata->>'lunch_order_id')::uuid
        ELSE NULL::uuid
      END                                           AS lunch_uuid
    FROM   public.view_student_debts vsd
    WHERE  vsd.student_id IN (SELECT sid FROM student_ids)
  ),

  -- ── C) Join con vouchers (LATERAL) ──────────────────────────────────────
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
          (
            db.deuda_tx_uuid IS NOT NULL
            AND rr.paid_transaction_ids IS NOT NULL
            AND db.deuda_tx_uuid = ANY(rr.paid_transaction_ids)
          )
          OR
          (
            db.lunch_uuid IS NOT NULL
            AND rr.lunch_order_ids IS NOT NULL
            AND db.lunch_uuid = ANY(rr.lunch_order_ids)
          )
          OR
          (
            db.fuente = 'saldo_negativo'
            AND rr.student_id  = db.student_id
            AND rr.request_type IN ('debt_payment', 'recharge')
          )
        )
      ORDER BY rr.created_at DESC
      LIMIT  1
    ) rr_match ON true
  )

  -- ── D) SELECT final con window functions para el resumen ─────────────────
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
    -- ── Resumen: mismo valor en cada fila (SUM OVER todo el result set) ──
    SUM(dv.monto) OVER ()
      AS summary_total_bruto,
    SUM(CASE WHEN dv.voucher_status = 'pending' THEN dv.monto ELSE 0 END) OVER ()
      AS summary_in_review,
    SUM(CASE WHEN (dv.voucher_status IS DISTINCT FROM 'pending') THEN dv.monto ELSE 0 END) OVER ()
      AS summary_neto_payable
  FROM debts_with_voucher dv
  ORDER BY dv.fecha DESC;

END;
$$;

COMMENT ON FUNCTION public.get_parent_debts_v2(uuid) IS
  'v2.1 2026-04-19 — Añade 3 window-function columns al resumen financiero: '
  'summary_total_bruto, summary_in_review, summary_neto_payable. '
  'Elimina la necesidad de .reduce() en el frontend (Ley de No-Cálculo). '
  'Retrocompatible: las 13 columnas originales no cambian.';
