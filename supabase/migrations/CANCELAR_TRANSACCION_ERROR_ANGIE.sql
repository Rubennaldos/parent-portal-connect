-- ═══════════════════════════════════════════════
-- CANCELAR TRANSACCIÓN ERRÓNEA: Angie Del Carpio Zapata
-- Transacción: c9a8cbf7-13ab-4f45-a017-40c4dc950f4e
-- Motivo: No hay pedido para el 10 de febrero, es un error/duplicado
-- ═══════════════════════════════════════════════

-- OPCIÓN 1: Cancelar la transacción (marcar como cancelled)
-- Esto mantiene el registro pero no cuenta como deuda
UPDATE transactions
SET payment_status = 'cancelled',
    metadata = COALESCE(metadata, '{}'::jsonb) || 
               jsonb_build_object(
                 'cancelled_reason', 'Transacción errónea - No existe pedido para el 10 de febrero',
                 'cancelled_at', NOW()::text,
                 'cancelled_by', 'system_cleanup'
               )
WHERE id = 'c9a8cbf7-13ab-4f45-a017-40c4dc950f4e'
  AND teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND payment_status = 'pending';

-- OPCIÓN 2: Eliminar completamente la transacción (MÁS LIMPIO)
-- Descomenta esta sección si prefieres eliminar en lugar de cancelar
/*
DELETE FROM transactions
WHERE id = 'c9a8cbf7-13ab-4f45-a017-40c4dc950f4e'
  AND teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND payment_status = 'pending';
*/

-- VERIFICAR: Deuda después de cancelar
SELECT 
  COALESCE(SUM(ABS(amount)), 0) AS deuda_total_soles
FROM transactions
WHERE teacher_id = 'fb4c27a1-1a5b-410f-a9e4-cc2ecf1f1d07'
  AND payment_status = 'pending'
  AND amount < 0;
