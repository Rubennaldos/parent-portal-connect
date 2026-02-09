-- ============================================
-- CORREGIR SCHOOL_ID DE LA COMPRA POS DEL PROFESOR 2
-- ============================================

-- El Profesor 2 tiene school_id_1 = 8a0dbd73-0571-4db1-af5c-65f4948c4c98
-- La compra POS no tiene school_id (está en NULL)

BEGIN;

-- Actualizar la transacción de compra POS
UPDATE transactions
SET school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98'
WHERE id = '765e94f7-ea9f-4b98-98db-54994fd78201'
AND teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
AND description = 'Compra Profesor: Profesor 2 - 3 items';

-- Verificar
SELECT 
    'DESPUÉS DE ACTUALIZAR' as info,
    id,
    description,
    amount,
    payment_status,
    school_id,
    created_at
FROM transactions
WHERE teacher_id = 'd0fd25b6-3c46-444a-a278-988f08130bd1'
ORDER BY created_at DESC;

COMMIT;
