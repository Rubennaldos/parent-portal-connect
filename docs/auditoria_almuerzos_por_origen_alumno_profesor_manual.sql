-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA: Almuerzos por ORIGEN (alumno / profesor / manual)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DE DÓNDE SALEN LOS DATOS (fuente única por módulo)
-- ───────────────────────────────────────────────────────────────────────────
-- | Qué necesitas              | Tabla / módulo en el ERP                    |
-- |----------------------------|-----------------------------------------------|
-- | Línea de pedido de almuerzo| public.lunch_orders (tabla central)           |
-- | Quién es el alumno         | public.students (join: lunch_orders.student_id)|
-- | Sede del alumno            | students.school_id → public.schools           |
-- | Quién es el profesor       | public.teacher_profiles (join: teacher_id)   |
-- | Sede del profesor          | teacher_profiles.school_id_1 → schools        |
-- | Pedido “manual” (caja/admin)| lunch_orders.manual_name + lunch_orders.school_id |
-- | Menú / categoría           | lunch_menus, lunch_categories (menu_id, etc.) |
-- | Montos                     | lunch_orders.base_price, final_price, quantity|
--
-- CLASIFICACIÓN por fila (exclusiva):
--   • profesor   → teacher_id IS NOT NULL (el pedido es del módulo profesor)
--   • alumno     → student_id IS NOT NULL y teacher_id IS NULL
--   • manual     → manual con nombre (manual_name no vacío), típico de operador/caja
--   • otro       → filas raras (revisar datos)
--
-- NOTA: En la app (LunchOrders, Comedor, calendario) el filtro por sede usa la misma
--       idea: estudiante → students.school_id; profesor → teacher_profiles.school_id_1.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1) TOTALES GLOBALES (todas las sedes) — pedidos + menús (quantity) ═══════
SELECT
  CASE
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.manual_name IS NOT NULL AND BTRIM(lo.manual_name) <> '' THEN 'manual'
    ELSE 'otro'
  END AS origen,

  COUNT(*) AS total_lineas_pedido,
  COALESCE(SUM(COALESCE(lo.quantity, 1)), 0)::bigint AS total_menus,

  COUNT(*) FILTER (
    WHERE NOT (lo.is_cancelled OR lo.status = 'cancelled')
  ) AS lineas_no_anuladas,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE NOT (lo.is_cancelled OR lo.status = 'cancelled')
  ), 0)::bigint AS menus_no_anulados,

  COUNT(*) FILTER (
    WHERE lo.is_cancelled OR lo.status = 'cancelled'
  ) AS lineas_anuladas,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE lo.is_cancelled OR lo.status = 'cancelled'
  ), 0)::bigint AS menus_anulados

FROM lunch_orders lo
GROUP BY 1
ORDER BY origen;


-- ═══ 2) MISMO DESGLOSE POR SEDE (school_id en la fila del pedido) ═════════════
--    Útil para ver MC1 vs otras unidades. La sede mostrada es la del pedido.
SELECT
  sch.code AS codigo_sede,
  sch.name AS nombre_sede,
  CASE
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.manual_name IS NOT NULL AND BTRIM(lo.manual_name) <> '' THEN 'manual'
    ELSE 'otro'
  END AS origen,
  COUNT(*) AS total_lineas,
  COALESCE(SUM(COALESCE(lo.quantity, 1)), 0)::bigint AS total_menus
FROM lunch_orders lo
LEFT JOIN schools sch ON sch.id = lo.school_id
GROUP BY sch.id, sch.code, sch.name,
  CASE
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.manual_name IS NOT NULL AND BTRIM(lo.manual_name) <> '' THEN 'manual'
    ELSE 'otro'
  END
ORDER BY sch.name NULLS LAST, origen;


-- ═══ 3) DETALLE MUESTRA (últimas 200 filas) — para ver nombres reales ══════════
--    De qué perfil salió cada uno: estudiante, profesor o texto manual.
SELECT
  lo.id AS pedido_id,
  lo.order_date AS fecha_pedido,
  lo.school_id,
  sch.code AS sede_code,
  CASE
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.manual_name IS NOT NULL AND BTRIM(lo.manual_name) <> '' THEN 'manual'
    ELSE 'otro'
  END AS origen,
  st.full_name AS nombre_alumno,
  tp.full_name AS nombre_profesor,
  lo.manual_name AS nombre_manual,
  COALESCE(lo.quantity, 1) AS cantidad_menus,
  lo.status,
  lo.is_cancelled
FROM lunch_orders lo
LEFT JOIN schools sch ON sch.id = lo.school_id
LEFT JOIN students st ON st.id = lo.student_id
LEFT JOIN teacher_profiles tp ON tp.id = lo.teacher_id
ORDER BY lo.created_at DESC
LIMIT 200;


-- ═══ 4) SOLO MC1 — totales por origen (misma lógica estricta de sede que la app) ═
--    Sustituye el UUID si cambia la sede.
/*
WITH mc1 AS (SELECT '9963c14c-22ff-4fcb-b5cc-599596896daa'::uuid AS school_id)
SELECT
  CASE
    WHEN lo.teacher_id IS NOT NULL THEN 'profesor'
    WHEN lo.student_id IS NOT NULL THEN 'alumno'
    WHEN lo.manual_name IS NOT NULL AND BTRIM(lo.manual_name) <> '' THEN 'manual'
    ELSE 'otro'
  END AS origen,
  COUNT(*) AS lineas,
  COALESCE(SUM(COALESCE(lo.quantity, 1)), 0)::bigint AS menus
FROM lunch_orders lo
CROSS JOIN mc1
WHERE
  EXISTS (SELECT 1 FROM students s WHERE s.id = lo.student_id AND s.school_id = mc1.school_id)
  OR EXISTS (SELECT 1 FROM teacher_profiles t WHERE t.id = lo.teacher_id AND t.school_id_1 = mc1.school_id)
  OR (lo.manual_name IS NOT NULL AND BTRIM(lo.manual_name) <> '' AND lo.school_id = mc1.school_id)
GROUP BY 1
ORDER BY 1;
*/
