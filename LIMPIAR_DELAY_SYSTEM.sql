-- ============================================================================
-- LIMPIAR Y REINSTALAR SISTEMA DE DELAY (Si ya existe)
-- ============================================================================

-- PASO 1: Eliminar todo lo existente
DROP INDEX IF EXISTS idx_purchase_visibility_school;
DROP FUNCTION IF EXISTS get_purchase_visibility_delay(UUID);
DROP FUNCTION IF EXISTS get_visibility_cutoff_date(UUID);
DROP TABLE IF EXISTS purchase_visibility_delay CASCADE;

-- PASO 2: Ahora ejecutar el archivo completo
-- Después de esto, ejecuta: SETUP_PURCHASE_VISIBILITY_DELAY.sql

SELECT '✅ Sistema anterior eliminado. Ahora ejecuta SETUP_PURCHASE_VISIBILITY_DELAY.sql' as status;
