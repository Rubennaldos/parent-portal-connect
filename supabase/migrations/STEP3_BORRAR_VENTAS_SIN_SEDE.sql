-- =====================================================
-- PASO 3: BORRAR VENTAS SIN SEDE
-- =====================================================
-- IMPORTANTE: Este paso es IRREVERSIBLE
-- Solo ejecuta si estás seguro después de revisar STEP1 y STEP2
-- =====================================================

-- Borrar items de las transacciones primero (por foreign key)
DELETE FROM transaction_items
WHERE transaction_id IN (
  SELECT id 
  FROM transactions 
  WHERE type = 'purchase' 
    AND school_id IS NULL
);

-- Borrar las transacciones sin school_id
DELETE FROM transactions
WHERE type = 'purchase' 
  AND school_id IS NULL;

-- Borrar ventas relacionadas en tabla sales
DELETE FROM sales
WHERE school_id IS NULL;

-- Confirmar resultado
SELECT 
  '✅ BORRADO COMPLETADO' as estado,
  COUNT(*) as ventas_restantes_sin_sede
FROM transactions
WHERE type = 'purchase' 
  AND school_id IS NULL;
