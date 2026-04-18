-- ═══════════════════════════════════════════════════════════════════════════
-- MC1 — Menús por día: padres | profesores | manual (1 feb → hoy)
-- Copiar y ejecutar TODO el bloque entre las líneas ═══ INICIO / FIN ═══
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ INICIO CONSULTA MC1 ═══
SELECT
  lo.order_date::date AS dia,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE lo.student_id IS NOT NULL AND lo.teacher_id IS NULL
  ), 0)::bigint AS menus_padres,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE lo.teacher_id IS NOT NULL
  ), 0)::bigint AS menus_profesores,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE lo.student_id IS NULL
      AND lo.teacher_id IS NULL
      AND lo.manual_name IS NOT NULL
      AND BTRIM(lo.manual_name) <> ''
  ), 0)::bigint AS menus_manual_otros,
  COALESCE(SUM(COALESCE(lo.quantity, 1)), 0)::bigint AS total_menus_dia
FROM lunch_orders lo
WHERE lo.order_date::date >= (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 month')::date
  AND lo.order_date::date <= CURRENT_DATE
  AND NOT (lo.is_cancelled OR lo.status = 'cancelled')
  AND (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.id = lo.student_id
        AND s.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'::uuid
    )
    OR EXISTS (
      SELECT 1 FROM teacher_profiles t
      WHERE t.id = lo.teacher_id
        AND t.school_id_1 = '9963c14c-22ff-4fcb-b5cc-599596896daa'::uuid
    )
    OR (
      lo.manual_name IS NOT NULL
      AND BTRIM(lo.manual_name) <> ''
      AND lo.school_id = '9963c14c-22ff-4fcb-b5cc-599596896daa'::uuid
    )
  )
GROUP BY lo.order_date::date
ORDER BY dia;
-- ═══ FIN CONSULTA MC1 ═══


-- (Opcional) Todas las sedes — ejecutar aparte, sin pegar con lo de arriba
/*
SELECT
  lo.order_date::date AS dia,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE lo.student_id IS NOT NULL AND lo.teacher_id IS NULL
  ), 0)::bigint AS menus_padres,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE lo.teacher_id IS NOT NULL
  ), 0)::bigint AS menus_profesores,
  COALESCE(SUM(COALESCE(lo.quantity, 1)) FILTER (
    WHERE lo.student_id IS NULL
      AND lo.teacher_id IS NULL
      AND lo.manual_name IS NOT NULL
      AND BTRIM(lo.manual_name) <> ''
  ), 0)::bigint AS menus_manual_otros
FROM lunch_orders lo
WHERE lo.order_date::date >= (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 month')::date
  AND lo.order_date::date <= CURRENT_DATE
  AND NOT (lo.is_cancelled OR lo.status = 'cancelled')
GROUP BY lo.order_date::date
ORDER BY dia;
*/
