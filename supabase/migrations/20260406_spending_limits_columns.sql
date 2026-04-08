-- ═══════════════════════════════════════════════════════════════════════════
-- Topes de Consumo — Columnas en la tabla students
-- Fecha: 2026-04-06
--
-- Las columnas limit_type, daily_limit, weekly_limit y monthly_limit
-- ya existen en la tabla. Aquí se agregan las columnas de seguimiento
-- del período activo y la fecha de próximo reinicio.
--
-- COLUMNAS NUEVAS:
--   current_period_spent  → cuánto ha gastado el alumno en el período actual.
--                           Lo actualiza la función del POS en cada compra.
--                           El modal lo usa para mostrar la barra de progreso.
--
--   next_reset_date       → cuándo se reinicia el tope (timestamptz UTC).
--                           Lo escribe el modal cuando el padre guarda el tope.
--                           Una función cron (Fase 2) lo usa para resetear
--                           current_period_spent cuando llega la fecha.
-- ═══════════════════════════════════════════════════════════════════════════

-- Agregar columnas solo si no existen
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS current_period_spent NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_reset_date       TIMESTAMPTZ   DEFAULT NULL;

-- Documentación de las columnas
COMMENT ON COLUMN students.current_period_spent IS
  'Gasto acumulado del alumno en el período activo (diario/semanal/mensual). '
  'Se incrementa en cada compra del POS y se resetea a 0 en next_reset_date.';

COMMENT ON COLUMN students.next_reset_date IS
  'Fecha/hora (UTC) en que se reiniciará current_period_spent. '
  'Equivale a la medianoche de Lima (05:00 UTC) del ciclo correspondiente. '
  'NULL si el alumno no tiene tope activo (limit_type = none).';

-- Índice para que la función de reseteo periódico sea eficiente
-- (busca todos los alumnos cuyo next_reset_date ya pasó)
CREATE INDEX IF NOT EXISTS idx_students_next_reset_date
  ON students (next_reset_date)
  WHERE next_reset_date IS NOT NULL;

-- Verificación final
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name  = 'students'
  AND column_name IN ('limit_type', 'daily_limit', 'weekly_limit', 'monthly_limit',
                      'current_period_spent', 'next_reset_date')
ORDER BY column_name;
