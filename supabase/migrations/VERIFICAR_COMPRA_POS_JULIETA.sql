-- ═══════════════════════════════════════════════
-- VERIFICAR COMPRA POS: Julieta Neyra Lamas
-- Transacción sin venta asociada
-- ═══════════════════════════════════════════════

-- PASO 1: Ver la transacción completa con toda su metadata
SELECT 
  t.id,
  t.created_at AS fecha,
  t.description,
  t.amount AS monto,
  t.payment_status,
  t.payment_method,
  t.metadata,
  t.school_id,
  t.student_id
FROM transactions t
WHERE t.id = 'b523b599-4b3e-4408-92e9-44ae09aeb7ab';

-- PASO 2: Ver si hay otras transacciones POS del mismo día para comparar
SELECT 
  t.id,
  t.created_at AS fecha,
  t.description,
  ABS(t.amount) AS monto,
  t.payment_method,
  CASE 
    WHEN EXISTS (SELECT 1 FROM sales s WHERE s.transaction_id::text = t.id::text) THEN '✅ Tiene venta'
    ELSE '❌ Sin venta'
  END AS tiene_venta
FROM transactions t
WHERE t.student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND t.type = 'purchase'
  AND t.payment_status = 'paid'
  AND DATE(t.created_at) = '2026-03-03'
ORDER BY t.created_at DESC;

-- PASO 3: Ver si hay alguna venta creada alrededor de esa hora (por si se perdió la relación)
SELECT 
  s.id AS sale_id,
  s.created_at AS fecha_venta,
  s.total,
  s.items,
  s.transaction_id,
  s.student_id,
  s.payment_method
FROM sales s
WHERE s.student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND DATE(s.created_at) = '2026-03-03'
  AND ABS(EXTRACT(EPOCH FROM (s.created_at - '2026-03-03 18:58:16'::timestamp))) < 300  -- 5 minutos de diferencia
ORDER BY s.created_at DESC;
