-- ¿Qué tienen de diferente los 269 huérfanos restantes?

SELECT
  CASE WHEN lo.student_id IS NOT NULL THEN 'tiene student_id' ELSE 'SIN student_id' END AS tiene_student,
  CASE WHEN lo.teacher_id IS NOT NULL THEN 'tiene teacher_id' ELSE 'sin teacher_id' END AS tiene_teacher,
  lo.status,
  COUNT(*) AS cantidad
FROM lunch_orders lo
LEFT JOIN transactions t ON (t.metadata->>'lunch_order_id')::uuid = lo.id
  AND t.is_deleted = false
WHERE lo.is_cancelled = false
  AND lo.status != 'cancelled'
  AND t.id IS NULL
GROUP BY 
  CASE WHEN lo.student_id IS NOT NULL THEN 'tiene student_id' ELSE 'SIN student_id' END,
  CASE WHEN lo.teacher_id IS NOT NULL THEN 'tiene teacher_id' ELSE 'sin teacher_id' END,
  lo.status
ORDER BY cantidad DESC;
