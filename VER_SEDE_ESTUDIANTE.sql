-- Verificar la sede del estudiante "prueba niño 1"
SELECT 
  s.id,
  s.full_name,
  s.school_id,
  sc.name as school_name
FROM students s
LEFT JOIN schools sc ON s.school_id = sc.id
WHERE s.full_name ILIKE '%prueba niño 1%'
  AND s.is_active = true;
