-- ============================================
-- CORREGIR TRANSACCIONES EXISTENTES
-- ============================================
-- Cambiar de 'paid' a 'pending' todas las transacciones que:
-- 1. Están marcadas como 'paid'
-- 2. NO tienen payment_method (o es null)
-- 3. Son de tipo 'purchase'
-- Esto indica que son CRÉDITOS, no pagos reales

BEGIN;

-- Ver cuántas transacciones se van a actualizar
SELECT 
    'ANTES DE ACTUALIZAR' as info,
    COUNT(*) as total_a_corregir
FROM transactions
WHERE type = 'purchase'
AND payment_status = 'paid'
AND payment_method IS NULL;

-- Actualizar transacciones
UPDATE transactions
SET payment_status = 'pending'
WHERE type = 'purchase'
AND payment_status = 'paid'
AND payment_method IS NULL;

-- Ver el resultado
SELECT 
    'DESPUÉS DE ACTUALIZAR' as info,
    COUNT(*) as total_corregidas
FROM transactions
WHERE type = 'purchase'
AND payment_status = 'pending'
AND payment_method IS NULL;

COMMIT;

-- Verificar algunas transacciones actualizadas
SELECT 
    'MUESTRA DE TRANSACCIONES CORREGIDAS' as info,
    t.id,
    t.teacher_id,
    tp.full_name,
    t.description,
    t.amount,
    t.payment_status,
    t.payment_method,
    t.created_at
FROM transactions t
LEFT JOIN teacher_profiles tp ON t.teacher_id = tp.id
WHERE t.type = 'purchase'
AND t.payment_status = 'pending'
AND t.payment_method IS NULL
ORDER BY t.created_at DESC
LIMIT 20;
