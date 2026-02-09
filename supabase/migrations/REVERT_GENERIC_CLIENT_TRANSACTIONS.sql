-- ============================================
-- REVERTIR TRANSACCIONES DE CLIENTE GENÉRICO
-- ============================================
-- Las transacciones de Cliente Genérico SÍ están pagadas,
-- no deben estar en 'pending'

BEGIN;

-- Ver cuántas transacciones de cliente genérico están en pending
SELECT 
    'ANTES DE REVERTIR' as info,
    COUNT(*) as total_cliente_generico_pending
FROM transactions
WHERE type = 'purchase'
AND payment_status = 'pending'
AND student_id IS NULL
AND teacher_id IS NULL
AND description ILIKE '%Cliente Genérico%';

-- Revertir a 'paid' las transacciones de Cliente Genérico
UPDATE transactions
SET payment_status = 'paid',
    payment_method = 'efectivo' -- Asumir efectivo por defecto
WHERE type = 'purchase'
AND payment_status = 'pending'
AND student_id IS NULL
AND teacher_id IS NULL
AND description ILIKE '%Cliente Genérico%';

-- Ver el resultado
SELECT 
    'DESPUÉS DE REVERTIR' as info,
    COUNT(*) as total_cliente_generico_paid
FROM transactions
WHERE type = 'purchase'
AND payment_status = 'paid'
AND student_id IS NULL
AND teacher_id IS NULL
AND description ILIKE '%Cliente Genérico%';

COMMIT;

-- Verificar
SELECT 
    'VERIFICACIÓN' as info,
    id,
    description,
    amount,
    payment_status,
    payment_method,
    created_at
FROM transactions
WHERE description ILIKE '%Cliente Genérico%'
ORDER BY created_at DESC
LIMIT 10;
