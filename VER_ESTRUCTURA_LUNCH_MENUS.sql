-- Ver la estructura de la tabla lunch_menus
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'lunch_menus'
ORDER BY ordinal_position;
