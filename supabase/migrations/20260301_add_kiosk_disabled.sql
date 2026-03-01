-- ============================================================
-- Migración: Agregar columna kiosk_disabled a students
-- Permite a padres desactivar la cuenta del kiosco para su hijo.
-- Cuando kiosk_disabled = true:
--   - El alumno NO puede comprar en el POS
--   - El alumno SÍ puede pedir almuerzo desde el calendario
-- ============================================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS kiosk_disabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN students.kiosk_disabled IS
  'Si es TRUE, el alumno no puede comprar en el kiosco (POS). Solo puede pedir almuerzo desde el calendario. Activado por el padre.';
