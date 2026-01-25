-- Ver sedes sin configuración de delay
SELECT 
  id,
  name AS sede_nombre,
  created_at
FROM schools
WHERE id NOT IN (SELECT school_id FROM purchase_visibility_delay WHERE school_id IS NOT NULL)
ORDER BY name;
