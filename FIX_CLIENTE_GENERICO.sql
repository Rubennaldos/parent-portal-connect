-- =====================================================
-- SCRIPT: PERMITIR CLIENTE GENÉRICO EN TRANSACTIONS
-- Fecha: 2026-01-07
-- Descripción: Hacer student_id opcional para ventas genéricas
-- =====================================================

-- Hacer student_id nullable (permite NULL)
ALTER TABLE transactions 
ALTER COLUMN student_id DROP NOT NULL;

-- Agregar índice para mejorar consultas de clientes genéricos
CREATE INDEX IF NOT EXISTS idx_transactions_generic_client 
ON transactions(student_id) 
WHERE student_id IS NULL;

-- Comentario explicativo
COMMENT ON COLUMN transactions.student_id IS 
'ID del estudiante (NULL para clientes genéricos)';

-- =====================================================
-- NOTA: Ahora las transacciones pueden tener student_id = NULL
-- para ventas a clientes genéricos (walk-in customers)
-- =====================================================

