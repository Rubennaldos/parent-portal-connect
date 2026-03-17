-- ═══════════════════════════════════════════════════════════════════════════════
-- LIMPIEZA PREVIA AL UNIQUE INDEX — lunch_orders
-- Solo toca duplicados con student_id REAL (no null).
-- Estrategia: conservar el pedido MÁS ANTIGUO (primer creado), cancelar los demás.
-- ═══════════════════════════════════════════════════════════════════════════════

-- PASO 1: Ver exactamente qué duplicados reales existen (student_id no null)
SELECT
  student_id,
  order_date,
  category_id,
  COUNT(*) AS total,
  ARRAY_AGG(id ORDER BY created_at ASC) AS ids_ordenados,
  ARRAY_AGG(status ORDER BY created_at ASC) AS estados
FROM lunch_orders
WHERE status != 'cancelled'
  AND student_id IS NOT NULL
GROUP BY student_id, order_date, category_id
HAVING COUNT(*) > 1
ORDER BY total DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 2: Cancelar los duplicados (conserva el más antiguo, cancela los demás)
-- Lee bien el resultado del PASO 1 antes de ejecutar esto.
-- ═══════════════════════════════════════════════════════════════════════════════
WITH duplicados AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_id, order_date, category_id
      ORDER BY created_at ASC  -- el primero (más antiguo) se conserva
    ) AS rn
  FROM lunch_orders
  WHERE status != 'cancelled'
    AND student_id IS NOT NULL
)
UPDATE lunch_orders
SET
  status = 'cancelled',
  updated_at = NOW()
WHERE id IN (
  SELECT id FROM duplicados WHERE rn > 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 3: Verificar que ya no quedan duplicados reales
-- Debe devolver 0 filas
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT
  student_id,
  order_date,
  category_id,
  COUNT(*) AS total
FROM lunch_orders
WHERE status != 'cancelled'
  AND student_id IS NOT NULL
GROUP BY student_id, order_date, category_id
HAVING COUNT(*) > 1;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 4: Crear el índice único parcial (ahora sí debe funcionar)
-- NOTA: Los registros con student_id = null son pedidos huérfanos históricos.
-- PostgreSQL los ignora en el índice UNIQUE porque null != null.
-- Los nuevos pedidos siempre tienen student_id, así que quedan protegidos.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_lunch_orders_unique_active
  ON lunch_orders (student_id, order_date, category_id)
  WHERE status != 'cancelled'
    AND student_id IS NOT NULL;  -- excluir huérfanos históricos

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 5: Confirmar que el índice quedó creado
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'lunch_orders'
  AND indexname = 'idx_lunch_orders_unique_active';
