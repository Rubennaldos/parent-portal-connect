-- PASO 0b — Diagnóstico alineado EXACTO con la regla del índice único.
-- El índice usa: WHERE status != 'cancelled' AND teacher_id IS NOT NULL
-- (NO filtra is_cancelled). Este query sí detecta esos casos.

SELECT
  lo.teacher_id,
  tp.full_name AS profesor,
  lo.order_date,
  lo.category_id,
  COUNT(*) AS cantidad,
  array_agg(lo.id ORDER BY lo.created_at DESC) AS ids,
  array_agg(lo.status ORDER BY lo.created_at DESC) AS estados,
  array_agg(COALESCE(lo.is_cancelled::text, 'null') ORDER BY lo.created_at DESC) AS is_cancelled_vals
FROM public.lunch_orders lo
LEFT JOIN public.teacher_profiles tp ON tp.id = lo.teacher_id
WHERE lo.teacher_id IS NOT NULL
  AND lo.status != 'cancelled'
GROUP BY lo.teacher_id, tp.full_name, lo.order_date, lo.category_id
HAVING COUNT(*) > 1
ORDER BY lo.order_date DESC;
