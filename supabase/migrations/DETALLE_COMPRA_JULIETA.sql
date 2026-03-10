-- ═══════════════════════════════════════════════
-- DETALLE DE COMPRA: Julieta Neyra Lamas
-- Transacción: b523b599-4b3e-4408-92e9-44ae09aeb7ab
-- Monto: 13.50 soles
-- ═══════════════════════════════════════════════

-- PASO 1: Ver detalles completos de la transacción
SELECT 
  t.id,
  t.created_at AS fecha,
  t.description,
  t.amount AS monto,
  t.payment_status,
  t.payment_method,
  t.metadata AS metadata_completo,
  t.metadata->>'source' AS source,
  t.metadata->>'ticket_code' AS ticket_code,
  t.metadata->>'items' AS items
FROM transactions t
WHERE t.id = 'b523b599-4b3e-4408-92e9-44ae09aeb7ab';

-- PASO 2: Ver si hay una venta (sale) asociada a esta transacción
SELECT 
  s.id AS sale_id,
  s.created_at AS fecha_venta,
  s.total AS total_venta,
  s.items AS items_venta,
  s.payment_method,
  s.cashier_id
FROM sales s
WHERE s.transaction_id = 'b523b599-4b3e-4408-92e9-44ae09aeb7ab'
ORDER BY s.created_at DESC
LIMIT 1;

-- PASO 3: Ver los items de la venta (si existe) - desglosados
SELECT 
  s.id AS sale_id,
  s.total AS total_venta,
  jsonb_array_elements(s.items) AS item_detalle
FROM sales s
WHERE s.transaction_id = 'b523b599-4b3e-4408-92e9-44ae09aeb7ab'
ORDER BY s.created_at DESC
LIMIT 1;
