-- ================================================
-- VERIFICAR COLUMNAS DE LA TABLA TRANSACTIONS
-- ================================================

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'transactions' 
ORDER BY ordinal_position;
