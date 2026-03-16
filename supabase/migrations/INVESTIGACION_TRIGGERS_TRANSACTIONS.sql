-- =====================================================================
-- INVESTIGACIÓN: ¿Qué TRIGGER está descontando balance al insertar
-- transacciones de almuerzo? Solo lectura.
-- =====================================================================

-- ─── 1. TODOS los triggers en la tabla transactions ──────────────────
SELECT
  tgname        AS trigger_name,
  CASE tgtype & 2  WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 8  THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 20 THEN 'INSERT OR UPDATE'
    WHEN 12 THEN 'INSERT OR DELETE'
    WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
  END AS event,
  proname       AS function_name,
  tgenabled     AS enabled
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.transactions'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;

-- ─── 2. Código fuente de CADA función de trigger en transactions ─────
SELECT
  p.proname    AS function_name,
  pg_get_functiondef(p.oid) AS function_code
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.transactions'::regclass
  AND NOT t.tgisinternal
ORDER BY p.proname;

-- ─── 3. Buscar CUALQUIER función que contenga 'balance' + 'students' ─
SELECT
  proname      AS function_name,
  prosrc       AS function_body
FROM pg_proc
WHERE prosrc ILIKE '%students%'
  AND prosrc ILIKE '%balance%'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname;

-- ─── 4. Triggers en tabla lunch_orders (por si acaso) ────────────────
SELECT
  tgname        AS trigger_name,
  CASE tgtype & 2  WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 8  THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 20 THEN 'INSERT OR UPDATE'
    WHEN 12 THEN 'INSERT OR DELETE'
    WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
  END AS event,
  proname       AS function_name,
  tgenabled     AS enabled
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.lunch_orders'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;

-- ─── 5. TODOS los alumnos afectados (paso 6 corregido) ──────────────
-- Detectar quiénes más tienen balance contaminado por almuerzos
WITH balance_check AS (
  SELECT
    s.id,
    s.full_name,
    sch.name AS sede,
    s.balance AS balance_actual,
    s.free_account,
    COALESCE(SUM(CASE WHEN t.type IN ('recharge', 'refund') AND t.is_deleted = false THEN t.amount ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NULL THEN t.amount ELSE 0 END), 0) AS balance_correcto,
    COALESCE(SUM(CASE WHEN t.type = 'purchase' AND t.payment_status != 'cancelled' AND t.is_deleted = false AND (t.metadata->>'lunch_order_id') IS NOT NULL THEN t.amount ELSE 0 END), 0) AS total_almuerzo
  FROM students s
  LEFT JOIN schools sch ON s.school_id = sch.id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance, s.free_account, sch.name
)
SELECT
  full_name AS "Alumno",
  sede AS "Sede",
  free_account AS "Cuenta Libre",
  balance_actual AS "Balance Actual",
  balance_correcto AS "Balance Correcto (sin almuerzos)",
  total_almuerzo AS "Monto Almuerzo que NO debería estar",
  balance_actual - balance_correcto AS "Discrepancia",
  CASE
    WHEN ABS(balance_actual - balance_correcto) < 0.01 THEN 'OK'
    WHEN ABS(balance_actual - balance_correcto + total_almuerzo) < 0.01 THEN 'CONTAMINADO POR ALMUERZOS'
    ELSE 'DISCREPANCIA DESCONOCIDA'
  END AS "Diagnóstico"
FROM balance_check
WHERE ABS(balance_actual - balance_correcto) > 0.01
ORDER BY ABS(balance_actual - balance_correcto) DESC;
