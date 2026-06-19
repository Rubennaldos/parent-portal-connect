-- PASO 1b — Dedup alineado EXACTO con la regla del índice único.
-- Usar solo si paso 0b devuelve filas, o si paso 2 falla con error 23505.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY teacher_id, order_date, category_id
      ORDER BY
        CASE status
          WHEN 'delivered' THEN 1
          WHEN 'confirmed' THEN 2
          WHEN 'pending'   THEN 3
          ELSE 4
        END ASC,
        created_at DESC
    ) AS rn
  FROM public.lunch_orders
  WHERE teacher_id IS NOT NULL
    AND status != 'cancelled'
)
UPDATE public.lunch_orders lo
SET
  status              = 'cancelled',
  is_cancelled        = true,
  cancellation_reason = 'DEDUP_MIGRATION: duplicado profesor idx (20260618)'
FROM ranked r
WHERE lo.id = r.id
  AND r.rn > 1
RETURNING lo.id, lo.teacher_id, lo.order_date, lo.status, lo.is_cancelled;
