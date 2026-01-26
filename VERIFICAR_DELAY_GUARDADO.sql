-- Verificar si el delay de 0 días se guardó correctamente
-- Para la sede "8a0dbd73-0571-4db1-af5c-65f4948c4c98"

SELECT 
  school_id,
  delay_days,
  created_at,
  updated_at
FROM purchase_visibility_delay
WHERE school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98';

-- Si no devuelve nada, crear manualmente:
/*
INSERT INTO purchase_visibility_delay (school_id, delay_days)
VALUES ('8a0dbd73-0571-4db1-af5c-65f4948c4c98', 0)
ON CONFLICT (school_id) 
DO UPDATE SET delay_days = 0, updated_at = NOW();
*/
