-- ============================================================
-- DIAGNÓSTICO: Ventas de ALUMNOS — Sede NORDIC
-- school_id: ba6219dd-05ce-43a4-b91b-47ca94744f97
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- PASO 1 — Resumen: antes vs desde 17-mar-2026 (Lima)
SELECT
  CASE
    WHEN t.created_at >= TIMESTAMPTZ '2026-03-17 00:00:00-05' THEN 'desde_17_mar_2026'
    ELSE 'antes_17_mar_2026'
  END AS periodo,
  COUNT(*) FILTER (WHERE t.student_id IS NOT NULL) AS ventas_alumnos,
  COUNT(*) AS total_ventas_todas,
  ROUND(SUM(ABS(t.amount)) FILTER (WHERE t.student_id IS NOT NULL)::numeric, 2) AS monto_alumnos_soles
FROM public.transactions t
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
GROUP BY 1
ORDER BY 1;


-- PASO 2 — Por día (desde 17-mar): kiosco vs almuerzo
SELECT
  DATE(t.created_at AT TIME ZONE 'America/Lima') AS fecha_lima,
  COUNT(*) FILTER (WHERE t.student_id IS NOT NULL AND (t.metadata->>'lunch_order_id') IS NULL) AS alumnos_kiosco,
  COUNT(*) FILTER (WHERE t.student_id IS NOT NULL AND (t.metadata->>'lunch_order_id') IS NOT NULL) AS alumnos_almuerzo,
  COUNT(*) FILTER (WHERE t.student_id IS NOT NULL) AS total_alumnos
FROM public.transactions t
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= TIMESTAMPTZ '2026-03-17 00:00:00-05'
GROUP BY 1
ORDER BY 1;


-- PASO 3 — Muestra detalle (últimas 30 ventas de alumnos en Nordic)
SELECT
  t.created_at AT TIME ZONE 'America/Lima' AS fecha_hora_lima,
  t.ticket_code,
  st.full_name AS alumno,
  ABS(t.amount) AS monto,
  t.payment_method,
  t.payment_status,
  CASE WHEN (t.metadata->>'lunch_order_id') IS NOT NULL THEN 'almuerzo' ELSE 'kiosco/pos' END AS canal,
  LEFT(t.description, 80) AS descripcion
FROM public.transactions t
LEFT JOIN public.students st ON st.id = t.student_id
WHERE t.school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97'
  AND t.student_id IS NOT NULL
  AND t.type IN ('purchase', 'sale')
  AND COALESCE(t.is_deleted, false) = false
  AND t.payment_status IS DISTINCT FROM 'cancelled'
  AND t.created_at >= TIMESTAMPTZ '2026-03-17 00:00:00-05'
ORDER BY t.created_at DESC
LIMIT 30;
