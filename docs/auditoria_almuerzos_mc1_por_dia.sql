-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA: Almuerzos por día — sede MC1 (Maristas Champagnat 1)
-- ═══════════════════════════════════════════════════════════════════════════
-- school_id: 9963c14c-22ff-4fcb-b5cc-599596896daa | code: MC1
--
-- IMPORTANTE — Corrección del criterio de sede (alineado a LunchOrders.tsx):
--   NO basta con lunch_orders.school_id = MC1 (puede haber inconsistencias).
--   Un pedido cuenta para MC1 solo si:
--     1) El alumno (students) pertenece a MC1, o
--     2) El profesor (teacher_profiles.school_id_1) pertenece a MC1, o
--     3) Es pedido manual (manual_name no vacío) Y lunch_orders.school_id = MC1
--
-- Objetivo: menús por fecha, separando anulados / no anulados.
--   • Anulado → is_cancelled = true O status = 'cancelled'
--   • Menús   = SUM(COALESCE(quantity, 1))
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (Opcional) Verificar sede ─────────────────────────────────────────────────
-- SELECT id, code, name FROM schools WHERE id = '9963c14c-22ff-4fcb-b5cc-599596896daa';


-- ── PRINCIPAL: Resumen por DÍA — solo pedidos “realmente” de MC1 ───────────────
WITH mc1 AS (
  SELECT '9963c14c-22ff-4fcb-b5cc-599596896daa'::uuid AS school_id
),
pedidos AS (
  SELECT
    lo.order_date::date AS dia,
    COALESCE(lo.quantity, 1) AS quantity,
    (lo.is_cancelled = true OR lo.status = 'cancelled') AS es_anulado
  FROM lunch_orders lo
  CROSS JOIN mc1
  WHERE
    -- Alumno de MC1
    EXISTS (
      SELECT 1 FROM students st
      WHERE st.id = lo.student_id AND st.school_id = mc1.school_id
    )
    OR
    -- Profesor de MC1 (misma lógica que LunchOrders: teacher.school_id_1)
    EXISTS (
      SELECT 1 FROM teacher_profiles tp
      WHERE tp.id = lo.teacher_id AND tp.school_id_1 = mc1.school_id
    )
    OR
    -- Pedido manual sin alumno/profesor en join: exige school_id en la fila
    (
      lo.manual_name IS NOT NULL
      AND BTRIM(lo.manual_name) <> ''
      AND lo.school_id = mc1.school_id
    )
)
SELECT
  dia,
  COUNT(*) FILTER (WHERE NOT es_anulado)                           AS pedidos_no_anulados,
  COALESCE(SUM(quantity) FILTER (WHERE NOT es_anulado), 0)::bigint AS menus_no_anulados,
  COUNT(*) FILTER (WHERE es_anulado)                             AS pedidos_anulados,
  COALESCE(SUM(quantity) FILTER (WHERE es_anulado), 0)::bigint    AS menus_anulados,
  COUNT(*)                                                        AS total_pedidos_dia,
  COALESCE(SUM(quantity), 0)::bigint                              AS total_menus_dia
FROM pedidos
GROUP BY dia
ORDER BY dia DESC;


-- ── DIAGNÓSTICO: filas que antes contaban por school_id pero el alumno NO es MC1 ─
-- (ejecutar solo si quieres ver posible “basura” histórica)
/*
SELECT COUNT(*) AS filas_sospechosas
FROM lunch_orders lo
CROSS JOIN (SELECT '9963c14c-22ff-4fcb-b5cc-599596896daa'::uuid AS school_id) mc1
WHERE lo.school_id = mc1.school_id
  AND lo.student_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM students st
    WHERE st.id = lo.student_id AND st.school_id IS DISTINCT FROM mc1.school_id
  );
*/


-- ── OPCIONAL: totales por rango de fechas ─────────────────────────────────────
/*
WITH mc1 AS (SELECT '9963c14c-22ff-4fcb-b5cc-599596896daa'::uuid AS school_id),
base AS (
  SELECT lo.quantity, lo.is_cancelled, lo.status
  FROM lunch_orders lo
  CROSS JOIN mc1
  WHERE (
    EXISTS (SELECT 1 FROM students st WHERE st.id = lo.student_id AND st.school_id = mc1.school_id)
    OR EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = lo.teacher_id AND tp.school_id_1 = mc1.school_id)
    OR (lo.manual_name IS NOT NULL AND BTRIM(lo.manual_name) <> '' AND lo.school_id = mc1.school_id)
  )
  AND lo.order_date >= DATE '2026-01-01'
  AND lo.order_date <  DATE '2027-01-01'
)
SELECT
  COALESCE(SUM(COALESCE(quantity,1)) FILTER (WHERE NOT (is_cancelled OR status = 'cancelled')), 0)::bigint AS menus_no_anulados,
  COALESCE(SUM(COALESCE(quantity,1)) FILTER (WHERE is_cancelled OR status = 'cancelled'), 0)::bigint       AS menus_anulados
FROM base;
*/
