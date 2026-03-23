-- ================================================================
-- AUDITORÍA FORENSE — FASE 4 — Cierre del caso
-- Objetivos:
--   A) Consultar audit_logs con columnas correctas
--   B) Investigar apply_payment_recharge (2do culpable)
--   C) Ver el código completo de apply_payment_recharge
--   D) Cruzar payment_transactions con alumnos fantasma
--   E) Alerta: set_student_balance sigue accesible via PUBLIC
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- A) AUDIT LOGS — columnas correctas
-- Estructura real: id, action, admin_user_id, target_user_id,
--                  target_user_email, timestamp, details, created_at
-- ════════════════════════════════════════════════════════════════

-- A1) Entradas de audit_logs relacionadas con students.balance
--     (busca en 'details' que es TEXT/JSON)
SELECT
  id,
  action,
  admin_user_id,
  target_user_id,
  target_user_email,
  timestamp,
  details
FROM audit_logs
WHERE
  details ILIKE '%balance%'
  OR details ILIKE '%f9f2569a%'   -- student_id de Ema
  OR details ILIKE '%set_student%'
  OR action  ILIKE '%balance%'
ORDER BY timestamp ASC
LIMIT 100;

-- A2) Últimas 100 entradas de audit_logs (cualquier tipo)
SELECT
  action,
  admin_user_id,
  target_user_email,
  target_user_id,
  timestamp,
  LEFT(details, 200) AS details_preview
FROM audit_logs
ORDER BY timestamp DESC
LIMIT 100;


-- ════════════════════════════════════════════════════════════════
-- B) INVESTIGAR apply_payment_recharge
-- Esta función actualiza students.balance cuando un pago en
-- payment_transactions es aprobado, SIN crear una fila en transactions.
-- ════════════════════════════════════════════════════════════════

-- B1) Código completo de apply_payment_recharge
SELECT pg_get_functiondef(oid) AS codigo_completo
FROM pg_proc
WHERE proname = 'apply_payment_recharge'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- B2) ¿Qué trigger dispara apply_payment_recharge?
--     (debe estar en payment_transactions)
SELECT
  tgname    AS trigger_nombre,
  CASE tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS momento,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 16 THEN 'UPDATE'
    WHEN 28 THEN 'INSERT/UPDATE/DELETE'
    ELSE tgtype::text
  END       AS evento,
  proname   AS funcion,
  tgenabled AS activo
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.payment_transactions'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;

-- B3) Registros en payment_transactions con recharge_applied = true
--     para los 97 alumnos con saldo fantasma
--     (solo primeros 50 por volumen)
SELECT
  pt.id,
  pt.student_id,
  s.full_name,
  pt.amount,
  pt.status,
  pt.recharge_applied,
  pt.payment_gateway,
  pt.created_at,
  pt.approved_at
FROM payment_transactions pt
JOIN students s ON s.id = pt.student_id
WHERE pt.recharge_applied = true
  AND pt.status = 'approved'
ORDER BY pt.approved_at DESC
LIMIT 50;

-- B4) Total de dinero cargado al balance por payment_transactions
--     (el monto total que entró por pasarela sin registrar en transactions)
SELECT
  COUNT(*)                            AS total_transacciones_pasarela,
  ROUND(SUM(pt.amount)::numeric, 2)   AS monto_total_inyectado,
  COUNT(DISTINCT pt.student_id)       AS alumnos_distintos
FROM payment_transactions pt
WHERE pt.recharge_applied = true
  AND pt.status = 'approved';

-- B5) Cruce: ¿cuántos de los 97 alumnos con saldo fantasma tienen
--     registros en payment_transactions?
WITH fantasma AS (
  SELECT
    s.id,
    s.full_name,
    s.balance AS balance_actual,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount ELSE 0
      END
    ), 0) AS balance_transacciones
  FROM students s
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance
  HAVING ABS(s.balance - COALESCE(SUM(
    CASE
      WHEN t.is_deleted = false AND t.payment_status != 'cancelled'
       AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
      THEN t.amount ELSE 0
    END
  ), 0)) > 0.01
)
SELECT
  f.full_name,
  ROUND((f.balance_actual - f.balance_transacciones)::numeric, 2) AS saldo_fantasma,
  ROUND(COALESCE(SUM(pt.amount), 0)::numeric, 2) AS ingresado_por_pasarela,
  ROUND((f.balance_actual - f.balance_transacciones - COALESCE(SUM(pt.amount), 0))::numeric, 2) AS diferencia_restante
FROM fantasma f
LEFT JOIN payment_transactions pt
  ON pt.student_id = f.id
  AND pt.recharge_applied = true
  AND pt.status = 'approved'
GROUP BY f.full_name, f.balance_actual, f.balance_transacciones
ORDER BY saldo_fantasma DESC
LIMIT 50;


-- ════════════════════════════════════════════════════════════════
-- C) ALERTA DE SEGURIDAD — set_student_balance con PUBLIC
-- El REVOKE revocó 'authenticated' y 'anon' pero PUBLIC persiste.
-- Verificar y completar el cierre.
-- ════════════════════════════════════════════════════════════════

-- C1) Confirmar el estado actual de permisos
SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'set_student_balance'
ORDER BY grantee;

-- C2) Si PUBLIC tiene EXECUTE, revocarlo también:
-- (DESCOMENTAR Y EJECUTAR SOLO si C1 confirma que PUBLIC tiene EXECUTE)
-- REVOKE EXECUTE ON FUNCTION set_student_balance(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
-- SELECT '✅ set_student_balance revocado de PUBLIC' AS resultado;
