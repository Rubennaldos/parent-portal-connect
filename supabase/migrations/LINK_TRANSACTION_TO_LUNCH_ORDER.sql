-- ============================================
-- VINCULAR TRANSACCIÓN CON SU LUNCH_ORDER
-- ============================================

BEGIN;

-- Agregar el lunch_order_id al metadata de la transacción del almuerzo
UPDATE transactions
SET metadata = jsonb_build_object(
    'lunch_order_id', '78d31bf8-80e2-48eb-9ed6-e84409997002',
    'source', 'lunch_order'
)
WHERE id = 'e153b0a6-7bd3-4178-b9fb-0e79a88b5707';

-- Verificar
SELECT 
    'DESPUÉS DE ACTUALIZAR' as info,
    t.id,
    t.description,
    t.amount,
    t.metadata,
    t.metadata->>'lunch_order_id' as lunch_order_id_extraido,
    t.created_at
FROM transactions t
WHERE t.teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
ORDER BY t.created_at DESC;

COMMIT;
