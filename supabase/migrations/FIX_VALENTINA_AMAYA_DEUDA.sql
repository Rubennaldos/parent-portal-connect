-- =====================================================================
-- FIX: Crear transacciones faltantes para pedidos huérfanos
-- Valentina Amaya Segura Castro + TODOS los huérfanos del sistema
-- =====================================================================

-- Paso 1: ¿Cuántos pedidos huérfanos hay en TODO el sistema?
-- (pedidos activos sin transacción correspondiente)
SELECT
  COUNT(*) AS pedidos_huerfanos_total,
  COUNT(DISTINCT lo.student_id) AS alumnos_afectados,
  SUM(lo.final_price) AS deuda_no_registrada_total
FROM lunch_orders lo
LEFT JOIN transactions t ON (t.metadata->>'lunch_order_id')::uuid = lo.id
  AND t.is_deleted = false
WHERE lo.is_cancelled = false
  AND lo.status != 'cancelled'
  AND t.id IS NULL;


-- Paso 2: Detalle por alumno (top 20)
SELECT
  s.full_name,
  COUNT(*) AS pedidos_sin_tx,
  SUM(lo.final_price) AS deuda_oculta
FROM lunch_orders lo
LEFT JOIN transactions t ON (t.metadata->>'lunch_order_id')::uuid = lo.id
  AND t.is_deleted = false
JOIN students s ON lo.student_id = s.id
WHERE lo.is_cancelled = false
  AND lo.status != 'cancelled'
  AND t.id IS NULL
GROUP BY s.full_name
ORDER BY pedidos_sin_tx DESC
LIMIT 20;


-- Paso 3: Crear transacciones para TODOS los pedidos huérfanos
-- Solo crea donde no exista ya una transacción
INSERT INTO transactions (
  student_id,
  type,
  amount,
  description,
  payment_status,
  payment_method,
  school_id,
  created_by,
  metadata,
  is_deleted
)
SELECT
  lo.student_id,
  'purchase',
  -ABS(lo.final_price),
  'Almuerzo - ' || COALESCE(lc.name, 'Sin categoría') || ' - ' || to_char(lo.order_date, 'DD/MM/YYYY'),
  'pending',
  NULL,
  lo.school_id,
  lo.created_by,
  jsonb_build_object(
    'lunch_order_id', lo.id,
    'source', 'fix_orphan_orders',
    'order_date', lo.order_date::text,
    'category_name', COALESCE(lc.name, 'Sin categoría')
  ),
  false
FROM lunch_orders lo
LEFT JOIN transactions t ON (t.metadata->>'lunch_order_id')::uuid = lo.id
  AND t.is_deleted = false
LEFT JOIN lunch_categories lc ON lo.category_id = lc.id
WHERE lo.is_cancelled = false
  AND lo.status != 'cancelled'
  AND t.id IS NULL
  AND lo.student_id IS NOT NULL;


-- Paso 4: Verificar que Valentina ahora tiene todas sus transacciones
SELECT
  'Pedidos activos' AS concepto,
  COUNT(*) AS cantidad
FROM lunch_orders lo
WHERE lo.student_id = '3b770b6d-db49-44ea-9bf5-1c0ca3cd4819'
  AND lo.is_cancelled = false

UNION ALL

SELECT
  'Transacciones de almuerzo' AS concepto,
  COUNT(*) AS cantidad
FROM transactions t
WHERE t.student_id = '3b770b6d-db49-44ea-9bf5-1c0ca3cd4819'
  AND t.metadata->>'lunch_order_id' IS NOT NULL
  AND t.is_deleted = false;


-- Paso 5: Verificar que ya no hay huérfanos en el sistema
SELECT
  COUNT(*) AS pedidos_huerfanos_restantes
FROM lunch_orders lo
LEFT JOIN transactions t ON (t.metadata->>'lunch_order_id')::uuid = lo.id
  AND t.is_deleted = false
WHERE lo.is_cancelled = false
  AND lo.status != 'cancelled'
  AND t.id IS NULL;
