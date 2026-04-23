-- ============================================================================
-- MIGRACIÓN: get_parent_debts_v2 → v2.2 (per-student summary columns)
-- Fecha: 2026-04-23
--
-- PROBLEMA:
--   El frontend aún calculaba con .reduce() los totales POR ALUMNO:
--     · studentPayable  = pending_transactions.filter(...).reduce(sum, tx.amount)
--     · studentInReview = Math.max(0, total_debt - studentPayable)
--     · total_debt      = mappedTransactions.reduce(sum, t.amount)
--   Esto viola la Regla 11.A "Cero Cálculos en el Cliente".
--
-- SOLUCIÓN:
--   Añadir 3 columnas de resumen POR ALUMNO calculadas con window functions
--   PARTITION BY student_id.  El frontend lee la primera fila de cada alumno.
--
--   · summary_student_total     → SUM(monto) por alumno
--   · summary_student_payable   → SUM(monto) por alumno, excl. vouchers 'pending'
--   · summary_student_in_review → SUM(monto) por alumno, solo vouchers 'pending'
--
-- TAMBIÉN:
--   Nueva función get_parent_wallet_total(uuid) → numeric
--   Sustituye el .reduce() de fetchWalletData sobre wallet_balance de students.
--
-- REGLA DE NO-CÁLCULO (Regla 11.A):
--   El frontend NUNCA suma ni resta montos.  Solo recibe valores finales y los pinta.
-- ============================================================================

-- ── 1. get_parent_debts_v2 v2.2 ─────────────────────────────────────────────
-- DROP obligatorio: Postgres no permite cambiar RETURN TABLE con OR REPLACE.
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
  -- ── Resumen GLOBAL (v2.1 — mismo valor en cada fila) ──────────────────
  summary_total_bruto      numeric,
  summary_in_review        numeric,
  summary_neto_payable     numeric,
  -- ── Resumen POR ALUMNO (v2.2 — varía por student_id) ─────────────────
  summary_student_total     numeric,  -- deuda bruta por alumno
  summary_student_payable   numeric,  -- lo que puede pagar ahora (excl. vouchers pending)
  summary_student_in_review numeric   -- lo que ya está en revisión
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

  -- ── D) SELECT final: resumen GLOBAL (OVER ()) + resumen POR ALUMNO (OVER PARTITION BY) ──
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

    -- Resumen global (v2.1)
    SUM(dv.monto) OVER ()
      AS summary_total_bruto,
    SUM(CASE WHEN dv.voucher_status = 'pending' THEN dv.monto ELSE 0 END) OVER ()
      AS summary_in_review,
    SUM(CASE WHEN (dv.voucher_status IS DISTINCT FROM 'pending') THEN dv.monto ELSE 0 END) OVER ()
      AS summary_neto_payable,

    -- Resumen por alumno (v2.2) — el frontend lee la primera fila de cada student_id
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
  'v2.2 2026-04-23 — Añade 3 window-function per-student columns: '
  'summary_student_total, summary_student_payable, summary_student_in_review. '
  'Elimina .reduce() financieros en el frontend (Regla 11.A Cero Cálculos en el Cliente). '
  'Retrocompatible con v2.1 (columnas globales summary_* sin cambios).';


-- ── 2. get_parent_wallet_total ───────────────────────────────────────────────
-- Suma el wallet_balance de todos los hijos activos del padre.
-- Sustituye el .reduce() en fetchWalletData del frontend.
DROP FUNCTION IF EXISTS public.get_parent_wallet_total(uuid);

CREATE OR REPLACE FUNCTION public.get_parent_wallet_total(p_parent_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(wallet_balance), 0)
  FROM   public.students
  WHERE  parent_id = p_parent_id
    AND  is_active = true;
$$;

COMMENT ON FUNCTION public.get_parent_wallet_total(uuid) IS
  '2026-04-23 — Suma wallet_balance de todos los hijos activos de un padre. '
  'Reemplaza el .reduce() sobre students en fetchWalletData (Regla 11.A).';
