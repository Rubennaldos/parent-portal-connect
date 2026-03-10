-- ============================================================
-- FIX: Rellenar school_id NULL en lunch_orders
-- Ejecutar cuantas veces sea necesario — es idempotente
-- ============================================================

-- PASO 1: Actualizar pedidos de estudiantes con school_id NULL
UPDATE lunch_orders lo
SET school_id = s.school_id
FROM students s
WHERE lo.student_id = s.id
  AND lo.school_id IS NULL
  AND s.school_id IS NOT NULL;

-- PASO 2: Actualizar pedidos de profesores con school_id NULL
UPDATE lunch_orders lo
SET school_id = tp.school_id_1
FROM teacher_profiles tp
WHERE lo.teacher_id = tp.id
  AND lo.school_id IS NULL
  AND tp.school_id_1 IS NOT NULL;

-- Verificar resultado (debería ser still_null = 0)
SELECT 
  COUNT(*) FILTER (WHERE school_id IS NULL) AS still_null,
  COUNT(*) FILTER (WHERE school_id IS NOT NULL) AS filled,
  COUNT(*) AS total
FROM lunch_orders;

-- Ver los que quedan con NULL (si alguno) para diagnosticar
SELECT id, student_id, teacher_id, manual_name, order_date, created_at
FROM lunch_orders
WHERE school_id IS NULL
LIMIT 20;
