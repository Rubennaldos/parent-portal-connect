-- =====================================================
-- VERIFICAR ESTRUCTURA DE lunch_orders
-- =====================================================

-- Ver columnas de lunch_orders
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'lunch_orders'
ORDER BY ordinal_position;
