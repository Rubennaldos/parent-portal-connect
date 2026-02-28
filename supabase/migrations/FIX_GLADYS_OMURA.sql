-- ============================================================
-- FIX COMPLETO: IGNACIO YAMADA OMURA - St. George's Villa
-- student_id: 43b21ba6-0a9a-4557-a006-6bc1a4169f72
-- Ejecutar en orden: PASO 1, luego PASO 2, luego PASO 3
-- ============================================================

-- ============================================================
-- VERIFICACIÓN PREVIA (siempre ejecutar primero)
-- ============================================================
SELECT order_date, status, is_cancelled, final_price, base_price,
       id AS order_id
FROM lunch_orders
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
ORDER BY order_date ASC;

-- ============================================================
-- PASO 1: Corregir precio S/15 → S/16 en pedidos Mar 2 al 8
-- (estas fechas ya no se borran, solo se corrige el precio)
-- ============================================================
UPDATE lunch_orders
SET 
  final_price = 16.00,
  base_price  = 16.00
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
  AND order_date BETWEEN '2026-03-02' AND '2026-03-08'
  AND is_cancelled = false
  AND (final_price = 15.00 OR base_price = 15.00);

-- Verificar:
SELECT order_date, final_price, base_price, status
FROM lunch_orders
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
  AND order_date BETWEEN '2026-03-02' AND '2026-03-08'
ORDER BY order_date;

-- ============================================================
-- PASO 2: BORRAR todos los pedidos del 9 de marzo en adelante
-- (activos Y cancelados, para dejar limpio y que ella re-ordene)
-- ============================================================
DELETE FROM lunch_orders
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
  AND order_date >= '2026-03-09';

-- Verificar que se borraron:
SELECT COUNT(*) AS pedidos_restantes_mar9_adelante
FROM lunch_orders
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
  AND order_date >= '2026-03-09';

-- ============================================================
-- PASO 3: Estado final - todos los pedidos que quedan
-- ============================================================
SELECT order_date, status, is_cancelled, final_price, base_price
FROM lunch_orders
WHERE student_id = '43b21ba6-0a9a-4557-a006-6bc1a4169f72'
ORDER BY order_date ASC;

-- ============================================================
-- PASO 4 (OPCIONAL): Aprobar el voucher de S/300
-- Si decides aprobar la recarga de S/300 como saldo:
-- Reemplaza [TU_ADMIN_ID] con tu user ID de admin
-- ============================================================
-- UPDATE recharge_requests
-- SET 
--   status      = 'approved',
--   approved_at = NOW(),
--   approved_by = '[TU_ADMIN_ID]',
--   notes       = 'Aprobado manualmente. Recarga de S/300 para cubrir almuerzos de marzo 2026.'
-- WHERE id = '6535d548-7ed8-4d47-b7bd-348f1399c54a'
--   AND status = 'pending';
