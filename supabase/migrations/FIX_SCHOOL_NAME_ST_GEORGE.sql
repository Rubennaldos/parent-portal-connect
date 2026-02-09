-- Ver todas las sedes y sus nombres actuales
SELECT 
  id,
  name,
  code,
  created_at
FROM schools
ORDER BY name;

-- Corregir el nombre de "San Jorge" a "St George"
-- (Ejecuta este UPDATE solo después de confirmar cuál es el ID correcto)

-- Primero, buscar específicamente la sede de San Jorge/St George
SELECT 
  id,
  name,
  code
FROM schools
WHERE name ILIKE '%jorge%' OR name ILIKE '%george%';

-- Si encuentras la sede que necesitas cambiar, ejecuta este UPDATE
-- (Reemplaza 'ID_DE_LA_SEDE' con el ID real)
/*
UPDATE schools
SET name = 'St George Miraflores'
WHERE name = 'San Jorge Miraflores';
-- o usa el ID específico:
-- WHERE id = 'ID_DE_LA_SEDE';
*/
