-- ═══════════════════════════════════════════════
-- VERIFICAR "CONSUMIDO": Julieta Neyra Lamas
-- ═══════════════════════════════════════════════

-- PASO 1: Ver TODAS las transacciones de compra (kiosco, sin almuerzos)
SELECT 
  t.id,
  t.created_at AS fecha,
  t.description,
  ABS(t.amount) AS monto,
  t.payment_status,
  t.metadata->>'source' AS source,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  CASE 
    WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN '❌ ALMUERZO (no cuenta)'
    ELSE '✅ KIOSCO (sí cuenta)'
  END AS tipo
FROM transactions t
WHERE t.student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND t.type = 'purchase'
  AND t.payment_status != 'cancelled'
ORDER BY t.created_at DESC;

-- PASO 2: Calcular "Consumido" (solo compras del kiosco, sin almuerzos)
SELECT 
  COALESCE(SUM(ABS(t.amount)), 0) AS total_consumido_kiosco
FROM transactions t
WHERE t.student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND t.type = 'purchase'
  AND t.payment_status != 'cancelled'
  AND t.metadata->>'lunch_order_id' IS NULL;  -- Solo kiosco, sin almuerzos

-- PASO 3: Verificar saldo actual y calcular diferencia
SELECT 
  s.balance AS saldo_actual,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) AS total_recargas,
  COALESCE(SUM(CASE 
    WHEN t.type = 'purchase' 
    AND t.payment_status != 'cancelled'
    AND t.metadata->>'lunch_order_id' IS NULL
    THEN ABS(t.amount) 
    ELSE 0 
  END), 0) AS total_consumido_kiosco,
  COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN t.amount ELSE 0 END), 0) 
  - COALESCE(SUM(CASE 
    WHEN t.type = 'purchase' 
    AND t.payment_status != 'cancelled'
    AND t.metadata->>'lunch_order_id' IS NULL
    THEN ABS(t.amount) 
    ELSE 0 
  END), 0) AS saldo_que_deberia_tener,
  s.balance AS saldo_actual_bd
FROM students s
LEFT JOIN transactions t ON t.student_id = s.id
WHERE s.id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
GROUP BY s.balance;
