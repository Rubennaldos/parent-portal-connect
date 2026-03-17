-- ═══════════════════════════════════════════════════════════════════════════════
-- UNIQUE PARTIAL INDEX — lunch_orders
-- Evita pedidos duplicados para el mismo alumno, fecha y categoría.
-- Los pedidos CANCELADOS no bloquean un nuevo pedido (status = 'cancelled' queda fuera).
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Verificar pedidos duplicados existentes ANTES de aplicar el constraint
--    (correr primero para saber si hay datos sucios que bloquearían el índice)
SELECT
  student_id,
  order_date,
  category_id,
  COUNT(*) AS total_pedidos,
  ARRAY_AGG(id ORDER BY created_at) AS ids,
  ARRAY_AGG(status ORDER BY created_at) AS estados
FROM lunch_orders
WHERE status != 'cancelled'
GROUP BY student_id, order_date, category_id
HAVING COUNT(*) > 1
ORDER BY total_pedidos DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Crear el índice único parcial
--    Solo aplica a pedidos NO cancelados: pending, confirmed, delivered
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_lunch_orders_unique_active
  ON lunch_orders (student_id, order_date, category_id)
  WHERE status != 'cancelled';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Verificar que el índice quedó creado correctamente
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'lunch_orders'
  AND indexname = 'idx_lunch_orders_unique_active';
