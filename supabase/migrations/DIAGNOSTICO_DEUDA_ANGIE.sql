-- ═══════════════════════════════════════════════
-- DEUDA TOTAL: Angie Del Carpio Zapata
-- UID: fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07
-- ═══════════════════════════════════════════════

-- PASO 1: Deuda por TRANSACCIONES pendientes
SELECT 
  'Transacciones' AS tipo,
  COUNT(*) AS cantidad,
  COALESCE(SUM(ABS(amount)), 0) AS deuda_total
FROM transactions
WHERE teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND payment_status = 'pending'
  AND amount < 0;

-- PASO 2: Deuda por PEDIDOS pendientes/confirmados (sin transacción pagada)
SELECT 
  'Pedidos sin pagar' AS tipo,
  COUNT(*) AS cantidad,
  COALESCE(SUM(final_price), 0) AS deuda_total
FROM lunch_orders lo
WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND lo.is_cancelled = false
  AND lo.status IN ('pending', 'confirmed')
  AND lo.final_price > 0
  -- Verificar que NO tenga una transacción pagada asociada
  AND NOT EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.teacher_id = lo.teacher_id
      AND t.payment_status = 'paid'
      AND (t.metadata->>'lunch_order_id')::text = lo.id::text
  );

-- PASO 3: RESUMEN TOTAL
SELECT 
  COALESCE(SUM(deuda_transacciones), 0) + COALESCE(SUM(deuda_pedidos), 0) AS deuda_total_soles
FROM (
  SELECT 
    COALESCE(SUM(ABS(amount)), 0) AS deuda_transacciones,
    0 AS deuda_pedidos
  FROM transactions
  WHERE teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
    AND payment_status = 'pending'
    AND amount < 0
  
  UNION ALL
  
  SELECT 
    0 AS deuda_transacciones,
    COALESCE(SUM(final_price), 0) AS deuda_pedidos
  FROM lunch_orders lo
  WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
    AND lo.is_cancelled = false
    AND lo.status IN ('pending', 'confirmed')
    AND lo.final_price > 0
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.teacher_id = lo.teacher_id
        AND t.payment_status = 'paid'
        AND (t.metadata->>'lunch_order_id')::text = lo.id::text
    )
) AS deudas;

-- PASO 4: DETALLE COMPLETO (para revisión)
SELECT 
  'Transacción' AS origen,
  t.id::text AS id,
  t.created_at AS fecha,
  t.description AS descripcion,
  ABS(t.amount) AS monto,
  t.payment_status AS estado,
  t.payment_method AS metodo_pago
FROM transactions t
WHERE t.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND t.payment_status = 'pending'
  AND t.amount < 0

UNION ALL

SELECT 
  'Pedido' AS origen,
  lo.id::text AS id,
  lo.order_date AS fecha,
  CONCAT('Almuerzo - ', COALESCE(lc.name, 'Sin categoría'), ' - ', lo.order_date) AS descripcion,
  lo.final_price AS monto,
  lo.status AS estado,
  NULL::text AS metodo_pago
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND lo.is_cancelled = false
  AND lo.status IN ('pending', 'confirmed')
  AND lo.final_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.teacher_id = lo.teacher_id
      AND t.payment_status = 'paid'
      AND (t.metadata->>'lunch_order_id')::text = lo.id::text
  )

ORDER BY fecha DESC;
