-- PASO 2 — Crea el candado único para profesores.
-- Debe decir: Success. No rows returned (el índice no devuelve filas, eso es normal).

CREATE UNIQUE INDEX IF NOT EXISTS idx_lunch_orders_unique_teacher_active
  ON public.lunch_orders (teacher_id, order_date, category_id)
  WHERE status != 'cancelled'
    AND teacher_id IS NOT NULL;

-- Verificación (debe devolver 1 fila):
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'lunch_orders'
  AND indexname = 'idx_lunch_orders_unique_teacher_active';
