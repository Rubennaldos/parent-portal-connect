-- ═══════════════════════════════════════════════
-- DEUDA CORREGIDA (sin duplicados): Angie Del Carpio Zapata
-- UID: fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07
-- ═══════════════════════════════════════════════

-- DEUDA REAL (evitando duplicados):
-- Solo contamos transacciones pendientes + pedidos SIN transacción asociada
SELECT 
  COALESCE(SUM(deuda_transacciones), 0) + COALESCE(SUM(deuda_pedidos_sin_tx), 0) AS deuda_total_soles
FROM (
  -- 1. Todas las transacciones pendientes
  SELECT 
    COALESCE(SUM(ABS(amount)), 0) AS deuda_transacciones,
    0 AS deuda_pedidos_sin_tx
  FROM transactions
  WHERE teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
    AND payment_status = 'pending'
    AND amount < 0
  
  UNION ALL
  
  -- 2. Solo pedidos que NO tienen ninguna transacción asociada (ni pagada ni pendiente)
  SELECT 
    0 AS deuda_transacciones,
    COALESCE(SUM(final_price), 0) AS deuda_pedidos_sin_tx
  FROM lunch_orders lo
  WHERE lo.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
    AND lo.is_cancelled = false
    AND lo.status IN ('pending', 'confirmed')
    AND lo.final_price > 0
    -- Excluir si tiene CUALQUIER transacción asociada (pagada O pendiente)
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.teacher_id = lo.teacher_id
        AND (t.metadata->>'lunch_order_id')::text = lo.id::text
    )
) AS deudas;
