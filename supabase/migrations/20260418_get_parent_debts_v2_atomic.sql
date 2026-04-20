-- ============================================================================
-- RPC: get_parent_debts_v2
-- Fecha: 2026-04-18
--
-- PROBLEMA QUE RESUELVE:
--   La versión v1 (get_parent_debts) obligaba al frontend a hacer una
--   SEGUNDA query a recharge_requests para saber si cada deuda ya tiene
--   un voucher "en revisión". Esa segunda query abría una ventana de stale
--   data de ~200-400 ms entre los dos roundtrips, en la que:
--     · Un admin podía aprobar el voucher entre query-1 y query-2
--     · El padre veía el botón "Pagar" activo para una deuda ya resuelta
--
-- SOLUCIÓN (esta migración):
--   Un solo RPC devuelve deuda + estado del voucher en una query atómica.
--   El vínculo deuda-voucher se resuelve en el servidor con un LATERAL JOIN
--   que cubre los 3 tramos de view_student_debts:
--
--     TRAMO 1 (fuente='transaccion'):
--       recharge_requests.paid_transaction_ids ∋ deuda_id::uuid
--
--     TRAMO 2 (fuente='almuerzo_virtual'):
--       recharge_requests.lunch_order_ids ∋ metadata->>'lunch_order_id'::uuid
--
--     TRAMO 3 (fuente='saldo_negativo'):
--       recharge_requests.student_id = student_id
--       AND request_type IN ('debt_payment', 'recharge')
--
-- SEGURIDAD DE TIPOS (Grieta que cierra):
--   Un CTE pre-computa los UUID-cast (deuda_tx_uuid, lunch_uuid) ANTES del
--   LATERAL. Así la expresión `vsd.deuda_id::uuid` solo se evalúa cuando
--   fuente='transaccion', eliminando riesgo de error de cast en tramos 2 y 3.
--
-- COMPATIBILIDAD:
--   El contrato de columnas de v1 se mantiene íntegro. Solo se añaden 3
--   columnas nuevas al final. El frontend puede llamar a v2 sin romper nada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_parent_debts_v2(p_parent_id uuid)
RETURNS TABLE(
  -- Columnas heredadas de get_parent_debts v1 (sin cambios)
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
  -- Columnas nuevas: estado del voucher embebido
  voucher_status           text,   -- 'pending' | 'rejected' | NULL (sin voucher)
  voucher_request_id       uuid,   -- ID del recharge_request vinculado (para display)
  voucher_rejection_reason text    -- Motivo si status='rejected'
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
  --    Los UUID-cast se calculan aquí, una sola vez, protegidos por CASE:
  --      · deuda_tx_uuid → solo para TRAMO 1 (transacciones reales)
  --      · lunch_uuid    → solo para TRAMO 2 (almuerzos virtuales)
  --    TRAMO 3 (saldo_negativo) no necesita UUID: se hace match por student_id.
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
  )

  -- ── C) SELECT final + LATERAL para estado de voucher ────────────────────
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
    rr_match.status                                 AS voucher_status,
    rr_match.id                                     AS voucher_request_id,
    rr_match.rejection_reason                       AS voucher_rejection_reason
  FROM debts_base db

  -- LATERAL: busca el voucher más reciente (pending/rejected) vinculado a esta deuda.
  -- Un único LATERAL cubre los 3 tramos mediante las columnas pre-computadas.
  LEFT JOIN LATERAL (
    SELECT rr.id, rr.status, rr.rejection_reason
    FROM   public.recharge_requests rr
    WHERE  rr.parent_id = p_parent_id
      AND  rr.status    IN ('pending', 'rejected')
      AND  (
        -- ─ TRAMO 1: transacción real ────────────────────────────────────
        (
          db.deuda_tx_uuid IS NOT NULL
          AND rr.paid_transaction_ids IS NOT NULL
          AND db.deuda_tx_uuid = ANY(rr.paid_transaction_ids)
        )
        OR
        -- ─ TRAMO 2: almuerzo virtual ────────────────────────────────────
        (
          db.lunch_uuid IS NOT NULL
          AND rr.lunch_order_ids IS NOT NULL
          AND db.lunch_uuid = ANY(rr.lunch_order_ids)
        )
        OR
        -- ─ TRAMO 3: saldo negativo (match a nivel alumno) ───────────────
        (
          db.fuente    = 'saldo_negativo'
          AND rr.student_id  = db.student_id
          AND rr.request_type IN ('debt_payment', 'recharge')
        )
      )
    ORDER BY rr.created_at DESC
    LIMIT  1
  ) rr_match ON true

  ORDER BY db.fecha DESC;

END;
$$;

COMMENT ON FUNCTION public.get_parent_debts_v2(uuid) IS
  'v2 2026-04-18 — Extiende get_parent_debts con voucher_status embebido. '
  'Un solo roundtrip DB: deuda + estado de voucher en query atómica. '
  'Elimina la segunda query de recharge_requests del frontend. '
  'Cubre los 3 tramos de view_student_debts con LATERAL JOIN seguro (CTE pre-cast). '
  'Retrocompatible: primeras 10 columnas idénticas a v1.';
