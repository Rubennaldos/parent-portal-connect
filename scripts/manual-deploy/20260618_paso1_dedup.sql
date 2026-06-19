-- PASO 1 — Cancela duplicados de profesores (conserva el mejor de cada grupo).
-- Debe devolver las filas canceladas. Si dice "0 rows", salta al paso 2.

WITH ranked_teacher_orders AS (
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
  WHERE teacher_id   IS NOT NULL
    AND status       != 'cancelled'
    AND is_cancelled IS NOT TRUE
)
UPDATE public.lunch_orders lo
SET
  status              = 'cancelled',
  is_cancelled        = true,
  cancellation_reason = 'DEDUP_MIGRATION: duplicado profesor (20260618)'
FROM ranked_teacher_orders r
WHERE lo.id = r.id
  AND r.rn > 1
RETURNING lo.id, lo.teacher_id, lo.order_date, lo.status;
