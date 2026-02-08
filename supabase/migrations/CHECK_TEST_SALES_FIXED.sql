-- ================================================
-- VERIFICAR VENTAS DE PRUEBA O TEST NO GUARDADAS
-- ================================================

-- 1. Ver ventas sin ticket_code (posibles almuerzos o ventas no finalizadas)
SELECT 
  COUNT(*) as ventas_sin_ticket,
  SUM(ABS(amount)) as monto_total,
  COUNT(DISTINCT created_by) as cajeros_diferentes
FROM transactions
WHERE ticket_code IS NULL
  AND type = 'purchase'
  AND created_at >= NOW() - INTERVAL '7 days'
  AND (is_deleted IS NULL OR is_deleted = false);

-- 2. Ver cajeros y cuántas ventas sin ticket_code tienen (posibles almuerzos)
SELECT 
  p.email as cajero_email,
  p.full_name as cajero_nombre,
  p.role as rol,
  COUNT(*) as ventas_sin_ticket,
  SUM(ABS(t.amount)) as monto_total
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
WHERE t.ticket_code IS NULL
  AND t.type = 'purchase'
  AND t.created_at >= NOW() - INTERVAL '7 days'
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
GROUP BY p.email, p.full_name, p.role
ORDER BY ventas_sin_ticket DESC;

-- 3. Ver si hay ventas duplicadas (mismo cajero, mismo monto, mismo minuto)
SELECT 
  p.email as cajero_email,
  p.full_name as cajero_nombre,
  t.amount,
  DATE_TRUNC('minute', t.created_at) as minuto,
  COUNT(*) as cantidad_duplicadas,
  ARRAY_AGG(t.ticket_code) as tickets,
  ARRAY_AGG(t.id) as ids
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
WHERE t.type = 'purchase'
  AND t.created_at >= NOW() - INTERVAL '7 days'
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
GROUP BY p.email, p.full_name, t.amount, DATE_TRUNC('minute', t.created_at)
HAVING COUNT(*) > 1
ORDER BY cantidad_duplicadas DESC;

-- 4. Ver ventas por cajero en los últimos 7 días
SELECT 
  p.email as cajero_email,
  p.full_name as cajero_nombre,
  p.role as rol,
  s.name as sede_asignada,
  COUNT(*) as total_ventas,
  COUNT(CASE WHEN t.ticket_code IS NOT NULL THEN 1 END) as con_ticket_POS,
  COUNT(CASE WHEN t.ticket_code IS NULL THEN 1 END) as sin_ticket_almuerzos,
  SUM(ABS(t.amount)) as monto_total,
  MIN(t.created_at) as primera_venta,
  MAX(t.created_at) as ultima_venta
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
LEFT JOIN schools s ON p.school_id = s.id
WHERE t.type = 'purchase'
  AND t.created_at >= NOW() - INTERVAL '7 days'
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
GROUP BY p.email, p.full_name, p.role, s.name
ORDER BY total_ventas DESC;

-- 5. Ver ventas con ticket_code (Punto de Venta)
SELECT 
  t.ticket_code,
  t.created_at,
  t.amount,
  p.email as cajero_email,
  p.full_name as cajero_nombre,
  s.name as sede_nombre
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
LEFT JOIN schools s ON t.school_id = s.id
WHERE t.ticket_code IS NOT NULL
  AND t.type = 'purchase'
  AND t.created_at >= NOW() - INTERVAL '3 days'
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
ORDER BY t.created_at DESC
LIMIT 20;

-- 6. Ver ventas sin ticket_code (Almuerzos)
SELECT 
  t.id,
  t.created_at,
  t.amount,
  p.email as cajero_email,
  p.full_name as cajero_nombre,
  s.name as sede_nombre,
  t.school_id
FROM transactions t
LEFT JOIN profiles p ON t.created_by = p.id
LEFT JOIN schools s ON t.school_id = s.id
WHERE t.ticket_code IS NULL
  AND t.type = 'purchase'
  AND t.created_at >= NOW() - INTERVAL '3 days'
  AND (t.is_deleted IS NULL OR t.is_deleted = false)
ORDER BY t.created_at DESC
LIMIT 20;

-- 7. Resumen general
SELECT 
  'Total Ventas' as descripcion,
  COUNT(*) as cantidad,
  SUM(ABS(amount)) as monto
FROM transactions
WHERE type = 'purchase'
  AND created_at >= NOW() - INTERVAL '7 days'
  AND (is_deleted IS NULL OR is_deleted = false)
UNION ALL
SELECT 
  'Ventas POS (con ticket)' as descripcion,
  COUNT(*) as cantidad,
  SUM(ABS(amount)) as monto
FROM transactions
WHERE type = 'purchase'
  AND ticket_code IS NOT NULL
  AND created_at >= NOW() - INTERVAL '7 days'
  AND (is_deleted IS NULL OR is_deleted = false)
UNION ALL
SELECT 
  'Almuerzos (sin ticket)' as descripcion,
  COUNT(*) as cantidad,
  SUM(ABS(amount)) as monto
FROM transactions
WHERE type = 'purchase'
  AND ticket_code IS NULL
  AND created_at >= NOW() - INTERVAL '7 days'
  AND (is_deleted IS NULL OR is_deleted = false);
