-- ═══════════════════════════════════════════════════════════════════════════
-- CIERRE: deuda kiosco ya reflejada en students.balance (misma lógica que Matías)
-- Alumna: Mia Jiménez Heredia
--
-- Misma regla: con trg_refresh_student_balance, pending y paid cuentan igual en
-- la suma → solo se corrige payment_status a 'paid' (no adjust_student_balance).
--
-- PASO 1: Ejecutar DIAGNÓSTICO y copiar el `id` del ticket pending (si existe).
-- PASO 2: Pegar ese UUID en el UPDATE del bloque APLICAR (o usar el ejemplo si
--         coincide con tu fila).
-- ═══════════════════════════════════════════════════════════════════════════

-- student_id Mia: 5050fce3-b428-4f2a-81cf-cb0286c80492
-- Ticket cerrado en producción: d00a96d2-eda9-4150-9525-ea60e68ff8c8 (T-FDA-006415, -11.00)


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) DIAGNÓSTICO (ejecutar primero)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT s.id, s.full_name, s.balance AS balance_en_tabla
FROM students s
WHERE s.id = '5050fce3-b428-4f2a-81cf-cb0286c80492';

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
WHERE t.student_id = '5050fce3-b428-4f2a-81cf-cb0286c80492'
  AND t.is_deleted = false
  AND t.payment_status <> 'cancelled';

-- Si esta lista sale vacía, ya no hay pendiente kiosco → no ejecutes el UPDATE.
SELECT t.id, t.amount, t.payment_status, t.payment_method, t.ticket_code, t.created_at
FROM transactions t
WHERE t.student_id = '5050fce3-b428-4f2a-81cf-cb0286c80492'
  AND t.type = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND (t.metadata->>'lunch_order_id') IS NULL
  AND t.is_deleted = false
ORDER BY t.created_at DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) APLICAR
--    Sustituye :tx_id por el UUID que devolvió la consulta anterior (columna id).
--    Si solo hay un pendiente y prefieres no pegar UUID, usa el bloque
--    "ALTERNATIVA UNA SOLA PENDIENTE" más abajo (solo si COUNT = 1).
-- ═══════════════════════════════════════════════════════════════════════════

-- Opción A — UUID confirmado por diagnóstico (2026-04-13)
BEGIN;

UPDATE transactions
SET
  payment_status = 'paid',
  payment_method = CASE
    WHEN payment_method IS NULL OR trim(payment_method::text) = '' THEN 'saldo'::text
    ELSE payment_method::text
  END
WHERE id = 'd00a96d2-eda9-4150-9525-ea60e68ff8c8'
  AND student_id = '5050fce3-b428-4f2a-81cf-cb0286c80492'
  AND type = 'purchase'
  AND payment_status = 'pending'
  AND (metadata->>'lunch_order_id') IS NULL
  AND is_deleted = false
RETURNING id, amount, payment_status, payment_method;

COMMIT;

-- Opción B — SOLO si el diagnóstico devolvió exactamente 1 fila pendiente kiosco.
-- Si hay 2+ pendientes, NO uses esto; usa Opción A con el UUID correcto.
/*
BEGIN;

UPDATE transactions t
SET
  payment_status = 'paid',
  payment_method = CASE
    WHEN t.payment_method IS NULL OR trim(t.payment_method::text) = '' THEN 'saldo'::text
    ELSE t.payment_method::text
  END
FROM (
  SELECT id
  FROM transactions
  WHERE student_id = '5050fce3-b428-4f2a-81cf-cb0286c80492'
    AND type = 'purchase'
    AND payment_status = 'pending'
    AND (metadata->>'lunch_order_id') IS NULL
    AND is_deleted = false
  ORDER BY created_at DESC
  LIMIT 1
) x
WHERE t.id = x.id
RETURNING t.id, t.amount, t.payment_status, t.payment_method;

COMMIT;
*/

-- Verificación
SELECT s.balance, s.full_name FROM students s WHERE s.id = '5050fce3-b428-4f2a-81cf-cb0286c80492';

SELECT t.id, t.amount, t.payment_status, t.payment_method, t.ticket_code
FROM transactions t
WHERE t.student_id = '5050fce3-b428-4f2a-81cf-cb0286c80492'
  AND t.type = 'purchase'
  AND t.payment_status IN ('pending', 'partial')
  AND (t.metadata->>'lunch_order_id') IS NULL
  AND t.is_deleted = false;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Si balance_en_tabla ≠ balance_calculado: sync_student_balance en dry_run
--    SELECT sync_student_balance('5050fce3-b428-4f2a-81cf-cb0286c80492', true);
-- ═══════════════════════════════════════════════════════════════════════════
