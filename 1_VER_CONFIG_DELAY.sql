-- Ver todas las configuraciones de delay existentes
SELECT 
  pvd.id,
  pvd.school_id,
  s.name AS sede_nombre,
  pvd.delay_days AS dias_delay,
  pvd.created_at AS fecha_creacion
FROM purchase_visibility_delay pvd
LEFT JOIN schools s ON s.id = pvd.school_id
ORDER BY s.name;
