-- Verificar estructura completa de lunch_categories
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'lunch_categories'
ORDER BY ordinal_position;

-- Ver valores existentes de target_type
SELECT DISTINCT target_type FROM lunch_categories;
