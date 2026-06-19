-- PASO 0 — Solo lectura. Muestra duplicados de profesores que bloquean el índice.
-- Ejecutar primero. Si devuelve filas, continúa con paso 1.

SELECT
  lo.teacher_id,
  tp.full_name AS profesor,
  lo.order_date,
  lo.category_id,
  COUNT(*) AS cantidad_duplicados,
  array_agg(lo.id ORDER BY lo.created_at DESC) AS ids_pedidos,
  array_agg(lo.status ORDER BY lo.created_at DESC) AS estados
FROM public.lunch_orders lo
LEFT JOIN public.teacher_profiles tp ON tp.id = lo.teacher_id
WHERE lo.teacher_id IS NOT NULL
  AND lo.status != 'cancelled'
  AND lo.is_cancelled IS NOT TRUE
GROUP BY lo.teacher_id, tp.full_name, lo.order_date, lo.category_id
HAVING COUNT(*) > 1
ORDER BY lo.order_date DESC;
