-- ============================================================
-- ELIMINAR TODAS LAS VENTAS, PEDIDOS Y VOUCHERS DE PRUEBA
-- Usuario: padremc1@gmail.com / hijo(s) prueba mc1
--
-- 1. Rechazar todos los vouchers (recharge_requests) de ese padre
-- 2. Cancelar todas las transacciones de sus hijos (payment_status = cancelled, is_deleted = true)
-- 3. Cancelar todos los pedidos de almuerzo (lunch_orders) de sus hijos
--
-- NO borra el perfil del padre ni los estudiantes; solo anula ventas/pedidos/vouchers.
-- NO toca students.balance (si hubo recargas aprobadas, revisar aparte).
-- ============================================================

-- PASO 0: DIAGNÓSTICO — ver qué se va a tocar (ejecutar primero)
SELECT 'Padre' AS tipo, p.id, p.email, p.full_name
FROM profiles p
WHERE p.email ILIKE '%padremc1%';

SELECT 'Estudiantes' AS tipo, s.id, s.full_name, s.parent_id
FROM students s
JOIN profiles p ON p.id = s.parent_id
WHERE p.email ILIKE '%padremc1%';

SELECT 'recharge_requests' AS tipo, rr.id, rr.status, rr.amount, rr.request_type, rr.created_at
FROM recharge_requests rr
JOIN profiles p ON p.id = rr.parent_id
WHERE p.email ILIKE '%padremc1%'
ORDER BY rr.created_at DESC;

SELECT 'transactions' AS tipo, t.id, t.ticket_code, t.amount, t.payment_status, t.type, t.created_at
FROM transactions t
JOIN students s ON s.id = t.student_id
JOIN profiles p ON p.id = s.parent_id
WHERE p.email ILIKE '%padremc1%'
ORDER BY t.created_at DESC;

SELECT 'lunch_orders' AS tipo, lo.id, lo.order_date, lo.status, lo.is_cancelled, lo.created_at
FROM lunch_orders lo
JOIN students s ON s.id = lo.student_id
JOIN profiles p ON p.id = s.parent_id
WHERE p.email ILIKE '%padremc1%'
ORDER BY lo.created_at DESC;

-- ========== PASO 1: EJECUTAR LIMPIEZA (solo después de revisar PASO 0) ==========
-- Ejecutar cada bloque por separado en este orden.

-- 1) Rechazar todos los vouchers de ese padre
UPDATE recharge_requests
SET status = 'rejected',
    approved_by = NULL,
    approved_at = NULL,
    rejection_reason = 'Eliminado: datos de prueba. Limpieza solicitada por administrador.'
WHERE parent_id = (SELECT id FROM profiles WHERE email ILIKE '%padremc1%' LIMIT 1);

-- 2) Cancelar todas las transacciones de los hijos de ese padre
UPDATE transactions
SET payment_status = 'cancelled',
    is_deleted = true,
    metadata = jsonb_set(
      COALESCE(metadata, '{}'),
      '{cancellation_reason}',
      '"Eliminado: datos de prueba. Limpieza solicitada por administrador."'
    ) || jsonb_build_object('manual_cleanup', true, 'cancelled_at', NOW()::text)
WHERE student_id IN (SELECT id FROM students WHERE parent_id = (SELECT id FROM profiles WHERE email ILIKE '%padremc1%' LIMIT 1));

-- 3) Cancelar todos los pedidos de almuerzo de esos hijos
UPDATE lunch_orders
SET is_cancelled = true,
    status = 'cancelled',
    cancellation_reason = 'Eliminado: datos de prueba. Limpieza solicitada por administrador.'
WHERE student_id IN (SELECT id FROM students WHERE parent_id = (SELECT id FROM profiles WHERE email ILIKE '%padremc1%' LIMIT 1))
  AND (is_cancelled = false OR is_cancelled IS NULL);
