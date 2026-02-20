-- ============================================
-- FIX: Permitir múltiples pedidos por día POR CATEGORÍA
-- ============================================
-- El constraint actual (student_id, order_date) impide que un
-- estudiante pida más de una categoría por día.
-- Lo cambiamos a (student_id, order_date, category_id) para
-- permitir 1 pedido por categoría por día.

-- 1. Eliminar el constraint antiguo
ALTER TABLE lunch_orders DROP CONSTRAINT IF EXISTS lunch_orders_student_id_order_date_key;

-- 2. Eliminar índices únicos antiguos que puedan existir
DROP INDEX IF EXISTS lunch_orders_student_id_order_date_key;
DROP INDEX IF EXISTS lunch_orders_student_order_date_unique;

-- 3. Crear nuevo índice único: 1 pedido por estudiante + fecha + categoría
CREATE UNIQUE INDEX IF NOT EXISTS lunch_orders_student_date_category_unique
ON lunch_orders (student_id, order_date, category_id)
WHERE student_id IS NOT NULL AND category_id IS NOT NULL AND is_cancelled = false;

-- 4. Crear índice único para profesores también
DROP INDEX IF EXISTS lunch_orders_teacher_order_date_unique;
CREATE UNIQUE INDEX IF NOT EXISTS lunch_orders_teacher_date_category_unique
ON lunch_orders (teacher_id, order_date, category_id)
WHERE teacher_id IS NOT NULL AND category_id IS NOT NULL AND is_cancelled = false;

SELECT '✅ Ahora cada estudiante/profesor puede pedir 1 categoría diferente por día' AS resultado;
