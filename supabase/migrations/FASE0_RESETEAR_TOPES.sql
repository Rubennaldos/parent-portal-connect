-- ============================================================
-- FASE 0: Resetear topes de TODOS los alumnos
-- Los topes se van a reconstruir en Fase 2
-- NO toca free_account ni balance
-- ============================================================

-- PRIMERO: Ver qué alumnos tienen topes configurados (solo lectura)
SELECT 
  s.id,
  s.full_name,
  s.limit_type,
  s.daily_limit,
  s.weekly_limit,
  s.monthly_limit,
  CASE WHEN s.free_account = false THEN 'Con Recargas' ELSE 'Cuenta Libre' END AS tipo_cuenta
FROM students s
WHERE s.limit_type IS NOT NULL 
  AND s.limit_type != 'none'
ORDER BY s.full_name;

-- DESPUÉS DE VERIFICAR: Resetear topes a 'none' y 0
-- DESCOMENTAR CUANDO ESTÉS LISTO PARA EJECUTAR:
/*
UPDATE students
SET 
  limit_type = 'none',
  daily_limit = 0,
  weekly_limit = 0,
  monthly_limit = 0
WHERE limit_type IS NOT NULL 
  AND limit_type != 'none';
*/

-- Verificar que se resetearon
-- SELECT COUNT(*) AS alumnos_con_topes FROM students WHERE limit_type IS NOT NULL AND limit_type != 'none';
