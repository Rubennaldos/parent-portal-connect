-- =====================================================
-- VERIFICAR QUE LOS PEDIDOS MANUALES TENGAN SCHOOL_ID
-- =====================================================

-- Ver pedidos manuales con su school_id
SELECT 
  '🛒 PEDIDOS MANUALES CON SCHOOL_ID' as tipo,
  lo.id,
  lo.manual_name,
  lo.school_id,
  s.name as sede_nombre,
  s.code as sede_codigo,
  lo.order_date,
  lo.payment_method,
  lo.final_price,
  lo.created_at
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
WHERE lo.manual_name IS NOT NULL
  AND lo.is_cancelled = false
  AND lo.order_date >= CURRENT_DATE
ORDER BY lo.created_at DESC;

-- Contar pedidos manuales por sede
SELECT 
  '📊 PEDIDOS MANUALES POR SEDE' as tipo,
  s.name as sede_nombre,
  COUNT(lo.id) as cantidad_pedidos,
  SUM(lo.final_price) as total_monto
FROM lunch_orders lo
LEFT JOIN schools s ON lo.school_id = s.id
WHERE lo.manual_name IS NOT NULL
  AND lo.is_cancelled = false
  AND lo.order_date >= CURRENT_DATE
GROUP BY s.name
ORDER BY cantidad_pedidos DESC;

-- Ver si hay pedidos manuales SIN school_id
SELECT 
  '⚠️ PEDIDOS MANUALES SIN SCHOOL_ID' as tipo,
  COUNT(*) as cantidad
FROM lunch_orders lo
WHERE lo.manual_name IS NOT NULL
  AND lo.school_id IS NULL
  AND lo.is_cancelled = false
  AND lo.order_date >= CURRENT_DATE;
