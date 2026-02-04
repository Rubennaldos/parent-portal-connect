-- =====================================================
-- PASO 2: VER DETALLE DE VENTAS SIN SEDE
-- =====================================================

SELECT 
  id,
  ticket_code,
  created_at,
  amount,
  description,
  student_id,
  teacher_id
FROM transactions
WHERE type = 'purchase' 
  AND school_id IS NULL
ORDER BY created_at DESC
LIMIT 50;
