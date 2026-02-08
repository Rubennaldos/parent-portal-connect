-- ================================================
-- VERIFICAR TODAS LAS VENTAS EN LA BASE DE DATOS
-- ================================================

-- 1. Contar todas las transacciones por tipo
SELECT 
  type,
  COUNT(*) as total,
  COUNT(CASE WHEN is_deleted = true THEN 1 END) as eliminadas,
  COUNT(CASE WHEN is_deleted IS NULL OR is_deleted = false THEN 1 END) as activas
FROM transactions
GROUP BY type
ORDER BY total DESC;

-- 2. Ver ventas de los últimos 30 días
SELECT 
  DATE(created_at) as fecha,
  COUNT(*) as total_ventas,
  SUM(amount) as total_monto,
  COUNT(DISTINCT school_id) as sedes_diferentes
FROM transactions
WHERE type = 'sale'
  AND created_at >= NOW() - INTERVAL '30 days'
  AND (is_deleted IS NULL OR is_deleted = false)
GROUP BY DATE(created_at)
ORDER BY fecha DESC;

-- 3. Ver detalles de las últimas 20 ventas
SELECT 
  id,
  ticket_code,
  DATE(created_at) as fecha,
  TO_CHAR(created_at, 'HH24:MI:SS') as hora,
  amount,
  type,
  is_deleted,
  school_id,
  created_by,
  (SELECT name FROM schools WHERE id = transactions.school_id) as sede_nombre
FROM transactions
WHERE type = 'sale'
  AND (is_deleted IS NULL OR is_deleted = false)
ORDER BY created_at DESC
LIMIT 20;

-- 4. Verificar si hay ventas con type diferente a 'sale'
SELECT 
  type,
  COUNT(*) as total,
  MIN(created_at) as primera_venta,
  MAX(created_at) as ultima_venta
FROM transactions
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY type
ORDER BY total DESC;

-- 5. Ver si hay ventas sin school_id
SELECT 
  COUNT(*) as ventas_sin_sede
FROM transactions
WHERE type = 'sale'
  AND school_id IS NULL
  AND created_at >= NOW() - INTERVAL '30 days';
