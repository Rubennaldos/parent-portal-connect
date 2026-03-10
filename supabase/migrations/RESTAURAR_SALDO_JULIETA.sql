-- ═══════════════════════════════════════════════
-- RESTAURAR SALDO: Julieta Neyra Lamas
-- ═══════════════════════════════════════════════

-- DIAGNÓSTICO:
-- ✅ Recarga de 50 soles confirmada (aprobada el 1 de marzo)
-- ❌ Saldo actual: 20.50
-- ✅ Saldo que debería tener: 36.50 (50 - 13.50 de compra POS)
-- ❌ Diferencia: -16.00 (falta restaurar 16 soles)

-- VERIFICAR: ¿Las otras 3 recargas de 16 soles generaron transacciones?
SELECT 
  rr.id AS recharge_request_id,
  rr.amount,
  rr.status,
  rr.approved_at,
  t.id AS transaction_id,
  t.amount AS transaction_amount,
  t.payment_status,
  CASE 
    WHEN t.id IS NULL THEN '❌ NO tiene transacción asociada'
    ELSE '✅ Tiene transacción'
  END AS estado
FROM recharge_requests rr
LEFT JOIN transactions t ON (
  t.student_id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88'
  AND t.type = 'recharge'
  AND (t.metadata->>'recharge_request_id')::text = rr.id::text
)
WHERE rr.parent_id = '69de8493-3693-4fd2-bd36-45077f2ef115'
  AND rr.status = 'approved'
ORDER BY rr.approved_at DESC;

-- OPCIÓN 1: Si solo falta restaurar 16 soles (la diferencia calculada)
-- Actualizar el saldo directamente
UPDATE students
SET balance = balance + 16.00
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- VERIFICAR saldo después de restaurar
SELECT 
  id,
  full_name,
  balance AS saldo_actualizado,
  'Debería ser: 36.50' AS saldo_esperado
FROM students
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- OPCIÓN 2: Si las otras 3 recargas de 16 soles NO generaron transacciones,
-- crear las transacciones faltantes (descomentar si es necesario)
/*
-- Crear transacción para la recarga de 16 soles (2e9e7038-f5a2-4c94-a6db-b18f866a15e1)
INSERT INTO transactions (
  student_id,
  type,
  amount,
  description,
  payment_status,
  payment_method,
  metadata,
  created_at
)
VALUES (
  'cd5fb741-72fd-445d-9f16-1a11ba92ca88',
  'recharge',
  16.00,
  'Recarga aprobada — 💜 Yape (Ref: 18578763)',
  'paid',
  'yape',
  jsonb_build_object(
    'recharge_request_id', '2e9e7038-f5a2-4c94-a6db-b18f866a15e1',
    'reference_code', '18578763',
    'source', 'voucher_recharge'
  ),
  '2026-03-01 22:00:34.27+00'
);

-- Repetir para las otras 2 recargas de 16 soles si es necesario
*/
