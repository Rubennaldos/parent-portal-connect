-- ============================================
-- LIMPIAR TODOS LOS ESTUDIANTES DEL SISTEMA
-- ============================================
-- IMPORTANTE: Este script elimina TODOS los estudiantes
-- Úsalo solo cuando necesites empezar desde cero

-- PASO 1: Eliminar todos los items de transacciones relacionados con estudiantes
DELETE FROM transaction_items
WHERE transaction_id IN (
  SELECT id FROM transactions WHERE student_id IS NOT NULL
);

-- PASO 2: Eliminar todas las transacciones de estudiantes
DELETE FROM transactions WHERE student_id IS NOT NULL;

-- PASO 3: Eliminar todos los estudiantes
DELETE FROM students;

-- ============================================
-- VERIFICACIÓN
-- ============================================

-- Ver cuántos estudiantes quedan (debe ser 0)
SELECT COUNT(*) as "Total Estudiantes" FROM students;

-- Ver cuántas transacciones de estudiantes quedan (debe ser 0)
SELECT COUNT(*) as "Transacciones de Estudiantes" 
FROM transactions 
WHERE student_id IS NOT NULL;

-- Ver cuántos items de transacción quedan
SELECT COUNT(*) as "Items de Transacciones" FROM transaction_items;

-- ============================================
-- ✅ LIMPIEZA COMPLETADA
-- ============================================
/*
DESPUÉS DE EJECUTAR ESTE SCRIPT:
- Todos los estudiantes han sido eliminados
- Todas las transacciones de estudiantes han sido eliminadas
- El sistema está listo para registrar nuevos estudiantes

NOTA: Los padres (profiles con role='parent') NO se eliminan
Si quieres eliminarlos también, ejecuta:
DELETE FROM profiles WHERE role = 'parent';
*/

