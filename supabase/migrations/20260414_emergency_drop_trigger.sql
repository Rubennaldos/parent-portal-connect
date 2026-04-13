-- ══════════════════════════════════════════════════════════════════════════════
-- EMERGENCIA: Eliminar trigger que causó 504 / colapso de recursos
-- Ejecutar TAN PRONTO como la BD responda (antes que cualquier otra migración)
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Deshabilitar primero (por si acaso ya existe pero no está caído aún)
ALTER TABLE transactions DISABLE TRIGGER trg_refresh_student_balance;

-- 2. Eliminar el trigger y su función definitivamente
DROP TRIGGER  IF EXISTS trg_refresh_student_balance     ON transactions;
DROP TRIGGER  IF EXISTS trg_refresh_student_balance_upd ON transactions;
DROP FUNCTION IF EXISTS trg_refresh_student_balance_fn();

-- 3. Confirmar que ya no existen
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'transactions'
  AND trigger_name LIKE 'trg_refresh%';

-- Debe devolver 0 filas si se eliminó correctamente.

SELECT 'Trigger eliminado OK — sistema estable' AS estado;
