-- =====================================================
-- AGREGAR RELACIÓN ENTRE TRANSACTIONS Y SCHOOLS
-- =====================================================
-- Este script agrega la columna school_id a transactions
-- y crea la relación de clave foránea con schools

-- PASO 1: Verificar si la columna school_id existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'transactions' 
        AND column_name = 'school_id'
    ) THEN
        -- Si no existe, agregarla
        ALTER TABLE transactions 
        ADD COLUMN school_id UUID;
        
        RAISE NOTICE 'Columna school_id agregada a transactions';
    ELSE
        RAISE NOTICE 'La columna school_id ya existe en transactions';
    END IF;
END $$;

-- PASO 2: Crear la relación de clave foránea si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'transactions_school_id_fkey'
        AND table_name = 'transactions'
    ) THEN
        -- Crear la foreign key
        ALTER TABLE transactions
        ADD CONSTRAINT transactions_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES schools(id)
        ON DELETE SET NULL;
        
        RAISE NOTICE 'Relación de clave foránea creada';
    ELSE
        RAISE NOTICE 'La relación de clave foránea ya existe';
    END IF;
END $$;

-- PASO 3: Actualizar las transacciones existentes con el school_id del estudiante
UPDATE transactions t
SET school_id = s.school_id
FROM students s
WHERE t.student_id = s.id
AND t.school_id IS NULL;

-- PASO 4: Crear un índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_transactions_school_id ON transactions(school_id);

-- VERIFICACIÓN
SELECT 
    COUNT(*) as total_transacciones,
    COUNT(school_id) as con_school_id,
    COUNT(*) - COUNT(school_id) as sin_school_id
FROM transactions;

SELECT 
    'transactions' as tabla,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions' 
AND column_name = 'school_id';

-- Verificar la relación
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.table_name = 'transactions' 
AND tc.constraint_type = 'FOREIGN KEY'
AND kcu.column_name = 'school_id';

