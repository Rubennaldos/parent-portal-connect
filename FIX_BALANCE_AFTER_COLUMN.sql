-- ========================================================
-- AGREGAR COLUMNA balance_after A transactions
-- ========================================================

-- 1. Verificar si la columna existe
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'transactions' 
AND column_name = 'balance_after';

-- 2. Agregar la columna si no existe
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS balance_after DECIMAL(10, 2);

-- 3. Agregar comentario
COMMENT ON COLUMN transactions.balance_after IS 'Saldo del estudiante después de la transacción';

-- 4. Verificar que se agregó
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'transactions'
ORDER BY ordinal_position;

-- ========================================================
-- ✅ COLUMNA AGREGADA
-- ========================================================
-- Ahora el POS podrá guardar el saldo después de cada compra
-- ========================================================

