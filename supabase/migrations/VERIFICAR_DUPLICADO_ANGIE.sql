-- ═══════════════════════════════════════════════
-- VERIFICAR DUPLICADO: Pedido del 12 de febrero
-- ═══════════════════════════════════════════════

-- Ver si el pedido ca0b0ba4-bc6e-4adc-86e4-d6298445d654 tiene transacción asociada
SELECT 
  'Pedido' AS tipo,
  lo.id AS pedido_id,
  lo.order_date,
  lo.status AS estado_pedido,
  lo.final_price AS monto_pedido,
  t.id AS transaccion_id,
  t.payment_status AS estado_transaccion,
  ABS(t.amount) AS monto_transaccion,
  t.metadata->>'lunch_order_id' AS lunch_order_id_en_metadata
FROM lunch_orders lo
LEFT JOIN transactions t ON (
  t.teacher_id = lo.teacher_id
  AND (t.metadata->>'lunch_order_id')::text = lo.id::text
)
WHERE lo.id = 'ca0b0ba4-bc6e-4adc-86e4-d6298445d654';

-- Ver TODAS las transacciones que mencionan ese pedido
SELECT 
  t.id,
  t.created_at,
  t.description,
  ABS(t.amount) AS monto,
  t.payment_status,
  t.metadata->>'lunch_order_id' AS lunch_order_id,
  t.metadata->>'source' AS source
FROM transactions t
WHERE t.teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND (
    (t.metadata->>'lunch_order_id')::text = 'ca0b0ba4-bc6e-4adc-86e4-d6298445d654'
    OR t.description LIKE '%12 de febrero%'
    OR t.description LIKE '%febrero - 12%'
  )
ORDER BY t.created_at DESC;
