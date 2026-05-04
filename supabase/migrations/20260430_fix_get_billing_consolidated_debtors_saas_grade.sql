-- ============================================================================
-- REFACTORIZACIÓN SaaS-Grade: get_billing_consolidated_debtors
-- Fecha: 2026-04-30
--
-- PROBLEMAS ELIMINADOS:
--   1. NOT EXISTS con OR → mata índices → O(N×M) nested loop
--      FIX: covered_lunches CTE MATERIALIZED → hash anti-join O(N+M)
--
--   2. Filtros de sede y fecha aplicados DESPUÉS de leer toda la vista
--      FIX: filtros aplicados directamente en las tablas base (transactions,
--      lunch_orders) antes de cualquier JOIN o agrupación
--
--   3. COUNT(*) OVER() fuerza materialización de TODOS los rows antes del LIMIT
--      FIX: total_count CTE MATERIALIZED separado → el planner lo computa
--      una vez sin mezclar con la proyección jsonb
--
--   4. enriched referenciado dos veces → grouped (con jsonb_agg) se recomputaba
--      FIX: enriched AS MATERIALIZED → computa la cadena completa UNA sola vez
--
-- GARANTÍAS MANTENIDAS:
--   · Seguridad: SECURITY DEFINER + validación de rol (sin cambios)
--   · Idempotencia: función solo lectura (no hay idempotencia financiera)
--   · Auditabilidad: no toca datos, solo lectura
--   · view_student_debts NO se modifica: get_parent_debts_v2 sigue intacta
--   · Sin guardia de fecha: índices cubren la historia completa
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — ÍNDICES FUNCIONALES (todos idempotentes con IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Índice 1: B-tree funcional sobre metadata->>'lunch_order_id' ──────────
-- Cubre:
--   · covered_lunches Branch A: (metadata->>'lunch_order_id') IS NOT NULL
--   · Tramo 3 original en view_student_debts (backward compat)
-- Partial index: solo filas no eliminadas (excluye ~0% en producción estable)
CREATE INDEX IF NOT EXISTS idx_transactions_metadata_lunch_order_id
  ON public.transactions ((metadata->>'lunch_order_id'))
  WHERE is_deleted = false;

-- ── Índice 2: GIN sobre metadata completo ────────────────────────────────
-- Cubre:
--   · covered_lunches Branch B: metadata ? 'original_lunch_ids'
--   · Cualquier operador JSONB (@>, ?, ?|) sobre metadata
-- GIN es el índice nativo de PostgreSQL para búsquedas dentro de JSONB.
CREATE INDEX IF NOT EXISTS idx_transactions_metadata_gin
  ON public.transactions USING GIN (metadata)
  WHERE is_deleted = false;

-- ── Índice 3: pending purchases por sede y fecha ──────────────────────────
-- Cubre: pending_transactions CTE
--   WHERE type='purchase' AND is_deleted=false
--   AND payment_status IN ('pending','partial')
--   AND school_id = v_eff_school_id
--   AND created_at BETWEEN p_from_date AND p_until_date
-- school_id en posición 1 → index scan cuando hay filtro de sede.
-- created_at DESC → el planner puede evitar sort para ORDER BY latest.
CREATE INDEX IF NOT EXISTS idx_transactions_pending_school_date
  ON public.transactions (school_id, created_at DESC)
  WHERE is_deleted = false
    AND type = 'purchase'
    AND payment_status IN ('pending', 'partial');

-- ── Índice 4: lunch_orders activos por fecha y sede ──────────────────────
-- Cubre: pending_lunches CTE
--   WHERE is_cancelled=false AND school_id = v_eff_school_id
--   AND order_date BETWEEN ...
-- Excluye pedidos cancelados del índice (no participan en deudas).
CREATE INDEX IF NOT EXISTS idx_lunch_orders_active_school_date
  ON public.lunch_orders (school_id, order_date DESC)
  WHERE is_cancelled = false;

-- ── Índice 5: recharge_requests por student + tipo + estado ──────────────
-- Cubre: voucher_status CTE
--   WHERE request_type IN (...) AND status IN ('pending','rejected')
-- Permite index scan al filtrar solicitudes por alumno.
CREATE INDEX IF NOT EXISTS idx_recharge_requests_student_type_status
  ON public.recharge_requests (student_id, status, request_type)
  WHERE status IN ('pending', 'rejected')
    AND request_type IN ('lunch_payment', 'debt_payment');


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — FUNCIÓN REFACTORIZADA
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.get_billing_consolidated_debtors(
  p_school_id        uuid        DEFAULT NULL,
  p_until_date       timestamptz DEFAULT NULL,
  p_transaction_type text        DEFAULT NULL,
  p_search           text        DEFAULT NULL,
  p_offset           integer     DEFAULT 0,
  p_limit            integer     DEFAULT 50,
  p_from_date        timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_eff_school_id uuid;
  v_safe_limit    integer;
  v_total_count   integer;
  v_debtors       jsonb;
  v_is_search     boolean;
BEGIN

  -- ── Seguridad: verificar rol ──────────────────────────────────────────────
  v_caller_id := auth.uid();

  SELECT p.role, p.school_id
  INTO   v_caller_role, v_caller_school
  FROM   public.profiles p
  WHERE  p.id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('total_count', 0, 'debtors', '[]'::jsonb);
  END IF;

  -- admin_general / supervisor_red / superadmin pueden ver todas las sedes
  -- (p_school_id puede ser NULL → sin filtro de sede)
  IF v_caller_role IN ('admin_general', 'supervisor_red', 'superadmin') THEN
    v_eff_school_id := p_school_id;
  ELSE
    v_eff_school_id := v_caller_school;
  END IF;

  -- Límite seguro: mínimo 1, máximo 1000
  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000);

  -- Cuando hay búsqueda por nombre, ignorar filtros de fecha:
  -- el admin quiere encontrar al deudor sin importar el período.
  v_is_search := (p_search IS NOT NULL AND trim(p_search) <> '');

  -- ── Consulta principal ────────────────────────────────────────────────────
  WITH

  -- ① covered_lunches MATERIALIZED
  -- ─────────────────────────────────────────────────────────────────────────
  -- Reemplaza el NOT EXISTS (A OR B) de la versión anterior.
  --
  -- Problema anterior:
  --   NOT EXISTS (
  --     SELECT 1 FROM transactions t2
  --     WHERE (t2.metadata->>'lunch_order_id') = lo.id::text   -- condición A
  --        OR (t2.metadata->'original_lunch_ids' @> to_jsonb(...))  -- condición B
  --   )
  --   El OR impide que el planner combine los dos índices (B-tree + GIN)
  --   en un único anti-join. Resultado: nested loop O(N×M).
  --
  -- Solución:
  --   Pre-computar el SET COMPLETO de lunch_ids ya cubiertos por alguna
  --   transacción (cualquier estado). MATERIALIZED → hash table en memoria.
  --   El anti-join en pending_lunches se convierte en un hash anti-join O(N+M).
  --
  -- Usa:
  --   Branch A → idx_transactions_metadata_lunch_order_id (B-tree funcional)
  --   Branch B → idx_transactions_metadata_gin (GIN)
  covered_lunches AS MATERIALIZED (

    -- Branch A: referencia directa por lunch_order_id en metadata
    SELECT (t.metadata->>'lunch_order_id')::uuid AS lid
    FROM   public.transactions t
    WHERE  t.is_deleted = false
      AND  t.metadata->>'lunch_order_id' IS NOT NULL
      AND  t.payment_status IN ('pending', 'partial', 'paid', 'cancelled')

    UNION

    -- Branch B: pagos split que apuntan a múltiples lunch_order_ids
    -- metadata->'original_lunch_ids' = ["uuid1", "uuid2", ...]
    SELECT (elem)::uuid AS lid
    FROM   public.transactions t,
           jsonb_array_elements_text(t.metadata -> 'original_lunch_ids') AS elem
    WHERE  t.is_deleted = false
      AND  t.metadata ? 'original_lunch_ids'
      AND  t.payment_status IN ('pending', 'partial', 'paid', 'cancelled')
      AND  elem IS NOT NULL
      AND  elem <> 'null'
  ),

  -- ② pending_transactions
  -- ─────────────────────────────────────────────────────────────────────────
  -- Tramo 1: compras de kiosco/POS con payment_status pendiente o parcial.
  -- Filtros de sede y fecha aplicados AQUÍ sobre la tabla base.
  -- Usa: idx_transactions_pending_school_date
  pending_transactions AS (
    SELECT
      t.id::text                                              AS id,
      ABS(t.amount)::numeric(10,2)                            AS amount,
      COALESCE(t.description, 'Deuda sin descripción')        AS description,
      t.created_at                                            AS created_at,
      t.metadata                                              AS metadata,
      t.student_id                                            AS student_id,
      t.teacher_id                                            AS teacher_id,
      t.manual_client_name                                    AS manual_client_name,
      t.school_id                                             AS school_id,
      ((t.metadata->>'lunch_order_id') IS NOT NULL)           AS is_lunch
    FROM public.transactions t
    WHERE t.type           = 'purchase'
      AND t.is_deleted     = false
      AND t.payment_status IN ('pending', 'partial')
      AND (v_eff_school_id IS NULL OR t.school_id = v_eff_school_id)
      -- En modo búsqueda ignorar fechas (el admin busca por nombre, no período)
      AND (v_is_search OR p_from_date  IS NULL OR t.created_at >= p_from_date)
      AND (v_is_search OR p_until_date IS NULL OR t.created_at <= p_until_date)
      AND (
        p_transaction_type IS NULL
        OR (p_transaction_type = 'cafeteria' AND (t.metadata->>'lunch_order_id') IS NULL)
        OR (p_transaction_type = 'lunch'     AND (t.metadata->>'lunch_order_id') IS NOT NULL)
      )
  ),

  -- ③ pending_lunches
  -- ─────────────────────────────────────────────────────────────────────────
  -- Tramo 2: almuerzos sin ninguna transacción vinculada.
  -- Anti-join via LEFT JOIN contra covered_lunches (hash join, O(1) por fila).
  -- Elimina el NOT EXISTS (A OR B) que causaba el timeout.
  -- Usa: idx_lunch_orders_active_school_date + covered_lunches hash table
  pending_lunches AS (
    SELECT
      ('lunch_' || lo.id::text)::text                         AS id,
      ABS(ROUND(
        CASE
          WHEN lo.final_price   IS NOT NULL AND lo.final_price   > 0
            THEN lo.final_price
          WHEN lc.price         IS NOT NULL AND lc.price         > 0
            THEN lc.price * COALESCE(lo.quantity, 1)
          WHEN lcfg.lunch_price IS NOT NULL AND lcfg.lunch_price > 0
            THEN lcfg.lunch_price * COALESCE(lo.quantity, 1)
          ELSE 7.50 * COALESCE(lo.quantity, 1)
        END, 2
      ))::numeric(10,2)                                       AS amount,
      (
        'Almuerzo - ' || COALESCE(lc.name, 'Menú') ||
        CASE WHEN COALESCE(lo.quantity, 1) > 1
          THEN ' (' || lo.quantity::text || 'x)' ELSE '' END ||
        ' - ' || to_char(lo.order_date::date, 'DD/MM/YYYY')
      )::text                                                 AS description,
      (lo.order_date::date + interval '12 hours')::timestamptz AS created_at,
      jsonb_build_object(
        'lunch_order_id', lo.id::text,
        'source',         'lunch_order',
        'order_date',     lo.order_date
      )                                                       AS metadata,
      lo.student_id                                           AS student_id,
      lo.teacher_id                                           AS teacher_id,
      lo.manual_name::text                                    AS manual_client_name,
      COALESCE(lo.school_id, st.school_id, tp.school_id_1)   AS school_id,
      true                                                    AS is_lunch
    FROM public.lunch_orders lo
    LEFT JOIN public.students          st   ON st.id  = lo.student_id
    LEFT JOIN public.teacher_profiles  tp   ON tp.id  = lo.teacher_id
    LEFT JOIN public.lunch_categories  lc   ON lc.id  = lo.category_id
    LEFT JOIN public.lunch_configuration lcfg
              ON lcfg.school_id = COALESCE(lo.school_id, st.school_id, tp.school_id_1)
    -- ── Anti-join: excluir almuerzos con transacción vinculada ─────────────
    -- Hash anti-join contra covered_lunches materializado.
    -- NULL en cl.lid significa "este lunch_order no tiene transacción".
    LEFT JOIN covered_lunches cl ON cl.lid = lo.id
    WHERE lo.is_cancelled = false
      AND lo.status NOT IN ('cancelled')
      AND cl.lid IS NULL  -- ← no existe ninguna transacción vinculada
      AND (v_eff_school_id IS NULL OR COALESCE(lo.school_id, st.school_id) = v_eff_school_id)
      AND (v_is_search OR p_from_date  IS NULL OR lo.order_date >= p_from_date::date)
      AND (v_is_search OR p_until_date IS NULL OR lo.order_date <= p_until_date::date)
      AND (p_transaction_type IS NULL OR p_transaction_type = 'lunch')
  ),

  -- ④ all_pending: unión de los dos tramos de deuda activa
  all_pending AS (
    SELECT * FROM pending_transactions
    UNION ALL
    SELECT * FROM pending_lunches
  ),

  -- ⑤ grouped: agrupar por deudor y calcular totales + array de transacciones
  grouped AS (
    SELECT
      COALESCE(
        ap.student_id::text,
        ap.teacher_id::text,
        'manual_' || lower(trim(COALESCE(ap.manual_client_name, ''))),
        'unk_' || ap.school_id::text
      )                                                       AS debtor_key,
      CASE
        WHEN ap.student_id IS NOT NULL THEN 'student'
        WHEN ap.teacher_id IS NOT NULL THEN 'teacher'
        ELSE 'manual'
      END                                                     AS client_type,
      ap.student_id,
      ap.teacher_id,
      ap.manual_client_name,
      ap.school_id,
      SUM(ap.amount)                                          AS total_amount,
      SUM(ap.amount) FILTER (WHERE     ap.is_lunch)           AS lunch_amount,
      SUM(ap.amount) FILTER (WHERE NOT ap.is_lunch)           AS cafeteria_amount,
      COUNT(*)                                                AS tx_count,
      BOOL_OR(ap.is_lunch)                                    AS has_lunch_debt,
      MAX(ap.created_at)                                      AS latest_tx_at,
      jsonb_agg(
        jsonb_build_object(
          'id',             ap.id,
          'amount',         ap.amount,
          'description',    ap.description,
          'created_at',     ap.created_at,
          'payment_status', 'pending',
          'metadata',       ap.metadata,
          'is_lunch',       ap.is_lunch
        ) ORDER BY ap.created_at DESC
      )                                                       AS transactions
    FROM all_pending ap
    GROUP BY
      COALESCE(
        ap.student_id::text,
        ap.teacher_id::text,
        'manual_' || lower(trim(COALESCE(ap.manual_client_name, ''))),
        'unk_' || ap.school_id::text
      ),
      ap.student_id,
      ap.teacher_id,
      ap.manual_client_name,
      ap.school_id,
      CASE
        WHEN ap.student_id IS NOT NULL THEN 'student'
        WHEN ap.teacher_id IS NOT NULL THEN 'teacher'
        ELSE 'manual'
      END
  ),

  -- ⑥ enriched MATERIALIZED
  -- ─────────────────────────────────────────────────────────────────────────
  -- Enriquecer con nombres (students, teacher_profiles, parent_profiles, schools)
  -- y aplicar el filtro de búsqueda por texto.
  --
  -- MATERIALIZED es crítico aquí:
  --   enriched es referenciado DOS veces abajo (total_count + SELECT final).
  --   Sin MATERIALIZED → PG 12+ inline → grouped (con jsonb_agg) se computa DOS veces.
  --   Con MATERIALIZED → computed ONCE, almacenado en memoria, leído dos veces.
  enriched AS MATERIALIZED (
    SELECT
      g.*,
      COALESCE(st.full_name, tp.full_name, g.manual_client_name, 'Sin nombre') AS client_name,
      COALESCE(st.grade,   '')                                AS student_grade,
      COALESCE(st.section, '')                                AS student_section,
      st.parent_id,
      COALESCE(pp.full_name, '')                              AS parent_name,
      COALESCE(pp.phone_1,   '')                              AS parent_phone,
      COALESCE(s.name, 'Sin sede')                            AS school_name
    FROM grouped g
    LEFT JOIN public.students         st ON st.id      = g.student_id
    LEFT JOIN public.teacher_profiles tp ON tp.id      = g.teacher_id
    LEFT JOIN public.parent_profiles  pp ON pp.user_id = st.parent_id
    LEFT JOIN public.schools           s ON s.id       = g.school_id
    WHERE (
      NOT v_is_search
      OR COALESCE(st.full_name,         '') ILIKE '%' || p_search || '%'
      OR COALESCE(tp.full_name,         '') ILIKE '%' || p_search || '%'
      OR COALESCE(g.manual_client_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(pp.full_name,         '') ILIKE '%' || p_search || '%'
      OR COALESCE(s.name,               '') ILIKE '%' || p_search || '%'
    )
  ),

  -- ⑦ voucher_status: estado de solicitudes de pago pendientes/rechazadas
  -- Usa: idx_recharge_requests_student_type_status
  voucher_status AS (
    SELECT
      rr.student_id,
      CASE
        WHEN bool_or(rr.status = 'pending')  THEN 'pending'
        WHEN bool_or(rr.status = 'rejected') THEN 'rejected'
        ELSE 'none'
      END AS v_status
    FROM public.recharge_requests rr
    WHERE rr.request_type IN ('lunch_payment', 'debt_payment')
      AND rr.status        IN ('pending', 'rejected')
    GROUP BY rr.student_id
  ),

  -- ⑧ total_count: COUNT separado sobre enriched ya materializado.
  -- Problema anterior: COUNT(*) OVER() dentro del SELECT final forzaba
  -- materialización de TODOS los rows ANTES de aplicar LIMIT.
  -- Solución: contar desde enriched MATERIALIZED (ligero, solo agrega un int).
  total_count AS (
    SELECT COUNT(*)::integer AS n FROM enriched
  )

  -- ── Resultado final: paginar SOBRE enriched materializado ─────────────────
  -- El jsonb_agg del outer SELECT solo procesa v_safe_limit rows (50 por defecto).
  -- grouped ya tiene las transactions pre-construidas: aquí solo empaquetamos el JSON.
  SELECT
    (SELECT n FROM total_count),
    COALESCE(
      jsonb_agg(sub.row_data ORDER BY sub.row_data->>'latest_tx_at' DESC),
      '[]'::jsonb
    )
  INTO v_total_count, v_debtors
  FROM (
    SELECT
      jsonb_build_object(
        'id',               e.debtor_key,
        'client_name',      e.client_name,
        'client_type',      e.client_type,
        'student_grade',    e.student_grade,
        'student_section',  e.student_section,
        'parent_id',        e.parent_id,
        'parent_name',      e.parent_name,
        'parent_phone',     e.parent_phone,
        'school_id',        e.school_id,
        'school_name',      e.school_name,
        'total_amount',     ROUND(e.total_amount, 2),
        'lunch_amount',     ROUND(COALESCE(e.lunch_amount,    0), 2),
        'cafeteria_amount', ROUND(COALESCE(e.cafeteria_amount,0), 2),
        'transaction_count',e.tx_count,
        'has_lunch_debt',   e.has_lunch_debt,
        'voucher_status',   COALESCE(vs.v_status, 'none'),
        'latest_tx_at',     e.latest_tx_at,
        'transactions',     e.transactions
      ) AS row_data
    FROM enriched e
    LEFT JOIN voucher_status vs ON vs.student_id = e.student_id
    ORDER BY e.latest_tx_at DESC NULLS LAST
    LIMIT  v_safe_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'total_count', COALESCE(v_total_count, 0),
    'debtors',     COALESCE(v_debtors, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_billing_consolidated_debtors(uuid, timestamptz, text, text, integer, integer, timestamptz)
  TO authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — Ejecutar en Supabase SQL Editor para confirmar
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Confirmar que la función existe con la firma correcta:
-- SELECT proname, pronargs FROM pg_proc
-- WHERE proname = 'get_billing_consolidated_debtors'
-- AND pronamespace = 'public'::regnamespace;

-- 2) Confirmar índices creados:
-- SELECT indexname, tablename, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--     'idx_transactions_metadata_lunch_order_id',
--     'idx_transactions_metadata_gin',
--     'idx_transactions_pending_school_date',
--     'idx_lunch_orders_active_school_date',
--     'idx_recharge_requests_student_type_status'
--   );

-- 3) Prueba de humo — debe retornar en < 3 segundos:
-- SELECT get_billing_consolidated_debtors(
--   NULL, NULL, NULL, NULL, 0, 50, NULL
-- );

-- 4) EXPLAIN ANALYZE para ver el plan real:
-- EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
-- SELECT get_billing_consolidated_debtors(NULL, NULL, NULL, NULL, 0, 50, NULL);
