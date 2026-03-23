-- ================================================================
-- PASO 3: Blindaje Anti-Duplicidad de Códigos de Operación
-- ================================================================
--
-- PROBLEMA:
--   Un cajero malicioso (o un error de red) podría intentar
--   registrar la misma venta dos veces usando el mismo código
--   de operación Yape/Plin o Transferencia.
--
-- SOLUCIÓN (doble blindaje):
--   1. Frontend: ya verifica antes de insertar (POS.tsx).
--   2. Esta migración agrega un ÍNDICE ÚNICO en la base de datos
--      como última línea de defensa ("candado en la cerradura").
--
-- ALCANCE DEL ÍNDICE:
--   - Por sede (school_id): el mismo código en dos colegios
--     diferentes SÍ está permitido (son cajeras distintas).
--   - Por día (DATE en Lima UTC-5): un código reutilizado al
--     día siguiente NO es bloqueado (los bancos a veces reutilizan
--     correlativo diario).
--   - Solo cuando operation_number existe y no está vacío.
--   - El código se normaliza a MAYÚSCULAS para comparación
--     case-insensitive: "op123" == "OP123" == "Op123".
--
-- CÓMO LEER EL ERROR DE DB:
--   Si el insert llega con un código duplicado, Supabase devuelve:
--   "duplicate key value violates unique constraint
--    idx_transactions_op_code_school_day"
-- ================================================================

-- Paso 1: Eliminar duplicados si existen antes de crear el índice
-- (No queremos que el índice falle al crearse por datos viejos)
-- Este CTE marca el PRIMERO como "keeper" y actualiza los demás
-- para que no colisionen al crear el índice.
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  WITH duplicados AS (
    SELECT
      id,
      school_id,
      DATE(created_at AT TIME ZONE 'America/Lima') AS dia,
      UPPER(metadata->>'operation_number') AS op_code,
      ROW_NUMBER() OVER (
        PARTITION BY school_id, DATE(created_at AT TIME ZONE 'America/Lima'), UPPER(metadata->>'operation_number')
        ORDER BY created_at ASC
      ) AS rn
    FROM transactions
    WHERE
      metadata->>'operation_number' IS NOT NULL
      AND metadata->>'operation_number' <> ''
  )
  UPDATE transactions t
  SET metadata = jsonb_set(
    t.metadata,
    '{operation_number}',
    to_jsonb(UPPER(t.metadata->>'operation_number') || '-DUP-' || d.rn::text)
  )
  FROM duplicados d
  WHERE t.id = d.id
    AND d.rn > 1;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count > 0 THEN
    RAISE NOTICE 'Se marcaron % transacciones duplicadas para limpiar el índice.', updated_count;
  END IF;
END $$;

-- Paso 2: Crear el índice único
-- UPPER() asegura que "op123" y "OP123" sean el mismo código.
-- La condición WHERE limita el índice solo a registros con código.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_op_code_school_day
ON public.transactions (
  school_id,
  DATE(created_at AT TIME ZONE 'America/Lima'),
  UPPER(metadata->>'operation_number')
)
WHERE
  (metadata->>'operation_number') IS NOT NULL
  AND (metadata->>'operation_number') <> '';

-- Verificación: mostrar cuántos registros cubre el índice
DO $$
DECLARE
  total_cubiertos INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_cubiertos
  FROM transactions
  WHERE
    metadata->>'operation_number' IS NOT NULL
    AND metadata->>'operation_number' <> '';

  RAISE NOTICE 'Índice creado. Cubre % transacciones con código de operación.', total_cubiertos;
END $$;
