-- =====================================================
-- LISTAR Y BORRAR RECARGAS DE LOS HIJOS DE UNA MAMÁ
-- =====================================================
-- 1) Identificas a la mamá por email o nombre.
-- 2) Ves qué hijos tienen recargas y cuánto.
-- 3) Revierte recargas: saldo en 0 + registro de devolución.
-- =====================================================

-- ═══════════════════════════════════════════════════════════════
-- PASO 1: BUSCAR A LA MAMÁ (elige una opción)
-- ═══════════════════════════════════════════════════════════════
-- Opción A: Por email de la mamá (reemplaza el email)
/*
SELECT id AS parent_id, full_name AS nombre_mama, email
FROM profiles
WHERE role = 'parent'
  AND email ILIKE '%@ejemplo.com%';   -- reemplaza con el email o parte del email
*/

-- Opción B: Por nombre de la mamá (reemplaza el nombre)
/*
SELECT id AS parent_id, full_name AS nombre_mama, email
FROM profiles
WHERE role = 'parent'
  AND full_name ILIKE '%nombre de la mama%';   -- reemplaza con el nombre
*/

-- Anota el parent_id (UUID) que te salga y úsalo abajo.

-- ═══════════════════════════════════════════════════════════════
-- PASO 2: VER QUÉ HIJOS TIENEN RECARGAS (y cuánto)
-- ═══════════════════════════════════════════════════════════════
-- Reemplaza '<PARENT_ID_DE_LA_MAMA>' por el UUID del paso 1 (ej: 'a00af258-ff8b-4f32-8f79-c88dbc0d4d2d')

SELECT
  p.email AS email_mama,
  p.full_name AS nombre_mama,
  s.id AS student_id,
  s.full_name AS nombre_hijo,
  s.balance AS saldo_actual,
  COALESCE(rec.total_recargas, 0) AS total_recargas_aplicadas,
  COALESCE(rr.pendientes, 0) AS recargas_pendientes_aprobacion
FROM profiles p
INNER JOIN students s ON s.parent_id = p.id
LEFT JOIN (
  SELECT student_id, SUM(amount) AS total_recargas
  FROM transactions
  WHERE type = 'recharge'
    AND (payment_status IS NULL OR payment_status != 'cancelled')
  GROUP BY student_id
) rec ON rec.student_id = s.id
LEFT JOIN (
  SELECT student_id, SUM(amount) AS pendientes
  FROM recharge_requests
  WHERE request_type = 'recharge' AND status = 'pending'
  GROUP BY student_id
) rr ON rr.student_id = s.id
WHERE p.id = '<PARENT_ID_DE_LA_MAMA>'
  AND (s.balance > 0 OR rec.total_recargas > 0 OR rr.pendientes > 0)
ORDER BY s.full_name;

-- Si no sale ninguna fila, esa mamá no tiene hijos con recargas/saldo.
-- Si salen filas, anota los student_id para el siguiente paso.

-- ═══════════════════════════════════════════════════════════════
-- PASO 3: BORRAR RECARGAS (dejar saldo en 0 y registrar devolución)
-- ═══════════════════════════════════════════════════════════════
-- Reemplaza los IDs de los hijos. Si solo hay 1 hijo, deja un solo UUID y comenta el otro.

-- 3A) Poner saldo en 0 para esos hijos
/*
UPDATE students
SET balance = 0
WHERE id IN (
  '<STUDENT_ID_HIJO_1>',
  '<STUDENT_ID_HIJO_2>'
);
*/

-- 3B) Registrar la devolución (una fila por hijo; ajusta el monto si no es el saldo completo)
-- Monto = lo que se le “devuelve” (normalmente el saldo_actual que viste en el PASO 2)
/*
INSERT INTO transactions (student_id, type, amount, payment_method, description, payment_status, created_at)
VALUES
  ('<STUDENT_ID_HIJO_1>', 'refund', <MONTO_1>, 'cash', 'Devolución recarga kiosco — error de concepto (sede sin kiosco)', 'paid', NOW()),
  ('<STUDENT_ID_HIJO_2>', 'refund', <MONTO_2>, 'cash', 'Devolución recarga kiosco — error de concepto (sede sin kiosco)', 'paid', NOW());
*/

-- ═══════════════════════════════════════════════════════════════
-- OPCIONAL: Cancelar solicitudes de recarga pendientes
-- ═══════════════════════════════════════════════════════════════
-- Si la mamá tiene recargas pendientes de aprobación y quieres cancelarlas:
/*
UPDATE recharge_requests
SET status = 'cancelled', updated_at = NOW()
WHERE request_type = 'recharge'
  AND status = 'pending'
  AND student_id IN (
    '<STUDENT_ID_HIJO_1>',
    '<STUDENT_ID_HIJO_2>'
  );
*/

-- ═══════════════════════════════════════════════════════════════
-- VERIFICACIÓN: Después de ejecutar 3A y 3B, vuelve a listar
-- ═══════════════════════════════════════════════════════════════
/*
SELECT s.id, s.full_name, s.balance
FROM students s
WHERE s.parent_id = '<PARENT_ID_DE_LA_MAMA>';
-- Saldo debería ser 0 para los hijos que actualizaste.
*/
