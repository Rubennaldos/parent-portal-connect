-- ═══════════════════════════════════════════════════════════════════════════
-- CIERRE: deuda kiosco que en realidad ya está reflejada en students.balance
-- Alumno: Matías Jiménez Heredia (ajusta UUIDs si cambian)
--
-- CONTEXTO (leer antes de ejecutar):
--   El trigger trg_refresh_student_balance recalcula balance sumando compras con
--   payment_status IN ('paid','pending','partial'). Por tanto, pasar un ticket
--   de 'pending' → 'paid' NO cambia la suma algebraica: el monto ya contaba.
--
--   → NO uses adjust_student_balance aquí salvo diagnóstico distinto (riesgo de
--     doble descuento si el trigger sigue activo).
--
-- PASO 1: Ejecutar solo el bloque "DIAGNÓSTICO" y revisar columnas.
-- PASO 2: Si cuadra, ejecutar el bloque "APLICAR" dentro de una transacción.
-- ═══════════════════════════════════════════════════════════════════════════

-- UUIDs de este caso (cambiar si aplica a otro alumno / otro ticket):
--   student_id  = 31518df9-25dc-481b-b508-ef4a03c08d2f  (Matías)
--   transaction = 26f925f4-1cf2-44f1-80c6-8bfdfccb77a5  (pendiente kiosco)


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) DIAGNÓSTICO (ejecutar primero; no modifica datos)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT s.id, s.full_name, s.balance AS balance_en_tabla
FROM students s
WHERE s.id = '31518df9-25dc-481b-b508-ef4a03c08d2f';

-- Saldo calculado igual que el trigger (kiosco, sin almuerzos en metadata)
SELECT COALESCE(SUM(
  CASE
    WHEN t.type = 'recharge' AND t.payment_status = 'paid' THEN ABS(t.amount)
    WHEN t.type = 'purchase'
         AND t.payment_status IN ('paid','pending','partial')
         AND (t.metadata->>'lunch_order_id') IS NULL THEN t.amount
    WHEN t.type = 'adjustment' AND t.payment_status = 'paid' THEN t.amount
    ELSE 0
  END
), 0) AS balance_calculado_trigger_style
FROM transactions t
WHERE t.student_id = '31518df9-25dc-481b-b508-ef4a03c08d2f'
  AND t.is_deleted = false
  AND t.payment_status <> 'cancelled';

-- Tickets kiosco aún pendientes / parciales (debería aparecer el de S/ 12)
SELECT t.id, t.amount, t.payment_status, t.payment_method, t.ticket_code, t.created_at
FROM transactions t
WHERE t.student_id = '31518df9-25dc-481b-b508-ef4a03c08d2f'
  AND t.type = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND (t.metadata->>'lunch_order_id') IS NULL
  AND t.is_deleted = false
ORDER BY t.created_at DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) APLICAR: pending → paid (sin tocar balance a mano)
--    Ejecutar solo si el diagnóstico muestra el ticket esperado y los saldos
--    cuadran con lo que ves en el portal.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE transactions
SET
  payment_status = 'paid',
  payment_method = CASE
    WHEN payment_method IS NULL OR trim(payment_method::text) = '' THEN 'saldo'::text
    ELSE payment_method::text
  END
WHERE id = '26f925f4-1cf2-44f1-80c6-8bfdfccb77a5'
  AND student_id = '31518df9-25dc-481b-b508-ef4a03c08d2f'
  AND type = 'purchase'
  AND payment_status = 'pending'
  AND (metadata->>'lunch_order_id') IS NULL
  AND is_deleted = false
RETURNING id, amount, payment_status, payment_method;
-- Debe devolver 1 fila. Si 0 filas: el ticket ya estaba paid o el id no coincide.

COMMIT;

-- Verificación rápida post-cambio
SELECT s.balance, s.full_name FROM students s WHERE s.id = '31518df9-25dc-481b-b508-ef4a03c08d2f';

SELECT t.id, t.amount, t.payment_status, t.payment_method
FROM transactions t
WHERE t.id = '26f925f4-1cf2-44f1-80c6-8bfdfccb77a5';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) SOLO SI balance_calculado ≠ balance_en_tabla (caso excepcional)
--    Preferir: SELECT sync_student_balance('31518df9-25dc-481b-b508-ef4a03c08d2f', true);
--    y luego en dry_run false si procede. NO mezclar con adjust_student_balance
--    sin revisar fila a fila.
-- ═══════════════════════════════════════════════════════════════════════════
