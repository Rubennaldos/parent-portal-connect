-- ============================================
-- FIX COMPLETO: is_cancelled con valor por defecto
-- ============================================

-- PASO 1: Ver el estado actual
SELECT 
  'ANTES DEL FIX' as momento,
  is_cancelled,
  COUNT(*) as cantidad
FROM lunch_orders
WHERE order_date >= '2026-02-03'
GROUP BY is_cancelled;

-- PASO 2: Actualizar todos los pedidos que tienen is_cancelled = NULL a false
UPDATE lunch_orders
SET is_cancelled = false
WHERE is_cancelled IS NULL;

-- PASO 3: Establecer valor por defecto para nuevos registros
ALTER TABLE lunch_orders
ALTER COLUMN is_cancelled SET DEFAULT false;

-- PASO 4: Hacer que la columna NO acepte NULL (solo si todos los NULL ya fueron actualizados)
ALTER TABLE lunch_orders
ALTER COLUMN is_cancelled SET NOT NULL;

-- PASO 5: Ver el resultado DESPUÉS del fix
SELECT 
  'DESPUES DEL FIX' as momento,
  is_cancelled,
  COUNT(*) as cantidad
FROM lunch_orders
WHERE order_date >= '2026-02-03'
GROUP BY is_cancelled;

-- PASO 6: Ver pedidos específicos de hoy
SELECT 
  id,
  COALESCE(
    (SELECT full_name FROM students WHERE students.id = lunch_orders.student_id),
    (SELECT full_name FROM teacher_profiles WHERE teacher_profiles.id = lunch_orders.teacher_id),
    manual_name,
    'Sin nombre'
  ) as nombre,
  order_date,
  status,
  is_cancelled,
  cancellation_reason,
  created_at
FROM lunch_orders
WHERE order_date = '2026-02-04'
ORDER BY created_at DESC;

-- ============================================
-- RESULTADO ESPERADO:
-- - ANTES: Puede tener NULL, true, false
-- - DESPUES: Solo true o false (sin NULL)
-- - La columna ya no acepta NULL
-- - Los pedidos de hoy se ven con su estado correcto
-- ============================================
