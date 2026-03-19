-- ============================================================
-- ESCUDO ANTIFRAUDE — FASE 0-B
-- Fecha: 2026-03-17
-- Revocar acceso a set_student_balance desde el cliente
-- ============================================================
-- PROBLEMA:
--   set_student_balance permite escribir un saldo ABSOLUTO
--   arbitrario (ej: balance = 999) saltándose el RPC seguro.
--   Con SECURITY DEFINER, se ejecuta con privilegios de dueño.
--   Si authenticated puede llamarla, cualquier admin
--   o padre técnico podría manipular saldos directamente.
--
-- SOLUCIÓN:
--   Revocar EXECUTE para 'authenticated' y 'anon'.
--   La función solo quedará accesible desde service_role
--   (backend / Edge Functions).
--
-- LO QUE NO SE TOCA:
--   adjust_student_balance → el RPC seguro, sigue igual.
-- ============================================================

-- En PostgreSQL, las funciones con parámetros DEFAULT se
-- revocan por su firma SIN el valor default.
-- La firma correcta es: (UUID, NUMERIC, BOOLEAN)

REVOKE EXECUTE 
ON FUNCTION set_student_balance(UUID, NUMERIC, BOOLEAN) 
FROM authenticated;

REVOKE EXECUTE 
ON FUNCTION set_student_balance(UUID, NUMERIC, BOOLEAN) 
FROM anon;

-- Verificación: confirmar que adjust_student_balance sigue accesible
-- (debe devolver 'grantee: authenticated' — si no aparece, hay que re-otorgarlo)
SELECT 
  grantee,
  routine_name,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN ('set_student_balance', 'adjust_student_balance')
ORDER BY routine_name, grantee;

SELECT '✅ FASE 0-B: REVOKE set_student_balance aplicado. Solo service_role puede usarla.' AS resultado;
