-- =====================================================
-- PASO 1: VER RESUMEN DE VENTAS SIN SEDE
-- =====================================================

SELECT 
  'RESUMEN' as info,
  COUNT(*) as total_transacciones,
  SUM(ABS(amount)) as monto_total_soles
FROM transactions
WHERE type = 'purchase' 
  AND school_id IS NULL;
