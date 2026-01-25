-- Ver datos del estudiante "hijo soluciones prueba"
SELECT 
  s.id AS student_id,
  s.full_name AS nombre_estudiante,
  s.school_id,
  sch.name AS sede_nombre,
  s.parent_id
FROM students s
LEFT JOIN schools sch ON sch.id = s.school_id
WHERE s.full_name ILIKE '%hijo soluciones prueba%';
