-- ============================================
-- ELIMINAR TRANSACCIÓN HUÉRFANA DEL 11 DE FEBRERO
-- ============================================

-- Esta transacción no tiene un pedido correspondiente en lunch_orders
DELETE FROM transactions
WHERE id = 'c24b3a41-36af-462b-96ae-247f04ae64f5'
AND teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
AND description = 'Almuerzo - 11 de febrero';

-- Verificar que se eliminó correctamente
SELECT 
    'Transacciones de almuerzo restantes' as info,
    t.id,
    t.description,
    t.amount,
    t.created_at
FROM transactions t
WHERE t.teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
AND t.description ILIKE '%almuerzo%'
ORDER BY t.created_at DESC;
