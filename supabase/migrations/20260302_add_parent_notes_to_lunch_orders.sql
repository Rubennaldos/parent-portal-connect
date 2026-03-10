-- =========================================================
-- Agregar campo parent_notes a lunch_orders
-- Para que los padres puedan agregar observaciones al pedido
-- =========================================================

-- Agregar columna si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'lunch_orders' AND column_name = 'parent_notes'
  ) THEN
    ALTER TABLE lunch_orders ADD COLUMN parent_notes TEXT DEFAULT NULL;
    RAISE NOTICE '✅ Columna parent_notes agregada a lunch_orders';
  ELSE
    RAISE NOTICE '⚠️ Columna parent_notes ya existe en lunch_orders';
  END IF;
END $$;

-- Comentario descriptivo
COMMENT ON COLUMN lunch_orders.parent_notes IS 'Observaciones del padre al hacer el pedido (alergias, preferencias, etc.)';
