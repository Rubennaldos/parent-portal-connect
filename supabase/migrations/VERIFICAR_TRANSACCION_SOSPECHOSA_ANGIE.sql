-- ═══════════════════════════════════════════════
-- VERIFICAR TRANSACCIÓN SOSPECHOSA: c9a8cbf7-13ab-4f45-a017-40c4dc950f4e
-- "Almuerzo - 10 de febrero" sin lunch_order_id
-- ═══════════════════════════════════════════════

-- PASO 1: Ver si hay algún pedido para el 10 de febrero
SELECT 
  'Pedido 10 Feb' AS tipo,
  lo.id,
  lo.order_date,
  lo.status,
  lo.is_cancelled,
  lo.final_price,
  lo.created_at,
  lc.name AS categoria,
  lm.main_course AS plato
FROM lunch_orders lo
LEFT JOIN lunch_categories lc ON lc.id = lo.category_id
LEFT JOIN lunch_menus lm ON lm.id = lo.menu_id
WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND lo.order_date = '2026-02-10'
ORDER BY lo.created_at ASC;

-- PASO 2: Ver TODAS las transacciones que mencionan "10 de febrero"
SELECT 
  'Transacción 10 Feb' AS tipo,
  t.id,
  t.created_at,
  t.description,
  ABS(t.amount) AS monto,
  t.payment_status,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'order_date' AS order_date_metadata,
  t.metadata->>'source' AS source
FROM transactions t
WHERE t.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND (t.description LIKE '%10 de febrero%'
       OR (t.metadata->>'order_date')::date = '2026-02-10')
ORDER BY t.created_at ASC;

-- PASO 3: Ver la transacción sospechosa en detalle
SELECT 
  t.id,
  t.created_at,
  t.description,
  ABS(t.amount) AS monto,
  t.payment_status,
  t.metadata AS metadata_completo
FROM transactions t
WHERE t.id = 'c9a8cbf7-13ab-4f45-a017-40c4dc950f4e';

-- PASO 4: Verificar si esta transacción debería ser eliminada o cancelada
-- (Si no hay pedido para el 10 de febrero, esta transacción es un error/duplicado)
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM lunch_orders lo
      WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
        AND lo.order_date = '2026-02-10'
        AND lo.is_cancelled = false
    ) THEN '✅ HAY pedido para el 10 de febrero - La transacción es válida'
    ELSE '❌ NO HAY pedido para el 10 de febrero - La transacción es un ERROR/DUPLICADO'
  END AS diagnostico;
