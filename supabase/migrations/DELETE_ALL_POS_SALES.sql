-- =====================================================
-- BORRAR TODAS LAS VENTAS DEL MÓDULO POS
-- Para empezar desde cero con las ventas
-- =====================================================

-- 1. Ver resumen de ventas antes de borrar
SELECT 
  t.school_id,
  s.name as school_name,
  COUNT(*) as total_ventas,
  SUM(t.amount) as total_monto
FROM transactions t
LEFT JOIN schools s ON t.school_id = s.id
WHERE t.type = 'sale'
  AND t.created_at >= '2026-02-01'
GROUP BY t.school_id, s.name
ORDER BY s.name;

-- 2. Ver total de items de transacciones
SELECT COUNT(*) as total_transaction_items
FROM transaction_items ti
INNER JOIN transactions t ON ti.transaction_id = t.id
WHERE t.type = 'sale'
  AND t.created_at >= '2026-02-01';

-- 3. BORRAR LOS ITEMS DE TRANSACCIONES PRIMERO (por la relación foreign key)
DELETE FROM transaction_items
WHERE transaction_id IN (
  SELECT id FROM transactions
  WHERE type = 'sale'
    AND created_at >= '2026-02-01'
);

-- 4. BORRAR LAS TRANSACCIONES DE VENTAS
DELETE FROM transactions
WHERE type = 'sale'
  AND created_at >= '2026-02-01';

-- 5. Verificar que se borraron correctamente
SELECT 
  t.school_id,
  s.name as school_name,
  COUNT(*) as total_ventas_restantes
FROM transactions t
LEFT JOIN schools s ON t.school_id = s.id
WHERE t.type = 'sale'
  AND t.created_at >= '2026-02-01'
GROUP BY t.school_id, s.name
ORDER BY s.name;

-- 6. Ver todas las transacciones que quedan (compras, recargas, etc)
SELECT 
  type,
  COUNT(*) as cantidad
FROM transactions
GROUP BY type
ORDER BY type;

-- =====================================================
-- IMPORTANTE:
-- Este script borra TODAS las ventas desde el 1 de febrero 2026
-- NO borra:
-- - Recargas (type = 'recharge')
-- - Compras de estudiantes/profesores (type = 'purchase')
-- - Transacciones de otros tipos
-- =====================================================
