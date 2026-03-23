-- ================================================================
-- AUDITORÍA FORENSE — FASE 3 — Escáner masivo + Triggers + Logs
-- Fecha: 2026-03-15
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- PARTE 1: ESCÁNER MASIVO
-- Cuántos alumnos tienen saldo que NO puede explicarse por
-- ninguna transacción registrada en la tabla transactions.
-- 
-- Fórmula correcta del balance esperado:
--   SUM( transacciones que NO son almuerzo, NO borradas, NO canceladas )
-- ════════════════════════════════════════════════════════════════

-- 1-A) Resumen global (cuántos alumnos y cuánta plata sin respaldo)
WITH balance_esperado AS (
  SELECT
    s.id,
    s.full_name,
    s.balance                        AS balance_actual,
    sch.name                         AS sede,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount
        ELSE 0
      END
    ), 0)                            AS balance_esperado_por_transacciones
  FROM students s
  LEFT JOIN schools sch ON sch.id = s.school_id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance, sch.name
)
SELECT
  COUNT(*) FILTER (WHERE ABS(balance_actual - balance_esperado_por_transacciones) > 0.01)
    AS alumnos_con_saldo_sin_respaldo,
  COUNT(*) FILTER (WHERE ABS(balance_actual - balance_esperado_por_transacciones) <= 0.01)
    AS alumnos_ok,
  COUNT(*)                          AS total_alumnos,
  ROUND(SUM(
    CASE WHEN ABS(balance_actual - balance_esperado_por_transacciones) > 0.01
    THEN balance_actual - balance_esperado_por_transacciones
    ELSE 0 END
  )::numeric, 2)                    AS monto_total_sin_respaldo
FROM balance_esperado;

-- 1-B) Detalle por alumno (ordenado por monto sin respaldo DESC)
WITH balance_esperado AS (
  SELECT
    s.id,
    s.full_name,
    s.balance                        AS balance_actual,
    sch.name                         AS sede,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount
        ELSE 0
      END
    ), 0)                            AS balance_esperado_por_transacciones
  FROM students s
  LEFT JOIN schools sch ON sch.id = s.school_id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance, sch.name
)
SELECT
  full_name                          AS "Alumno",
  sede                               AS "Sede",
  ROUND(balance_actual::numeric, 2)  AS "Balance BD",
  ROUND(balance_esperado_por_transacciones::numeric, 2)
                                     AS "Balance según transactions",
  ROUND((balance_actual - balance_esperado_por_transacciones)::numeric, 2)
                                     AS "Saldo sin respaldo (fantasma)"
FROM balance_esperado
WHERE ABS(balance_actual - balance_esperado_por_transacciones) > 0.01
ORDER BY (balance_actual - balance_esperado_por_transacciones) DESC
LIMIT 100;


-- ════════════════════════════════════════════════════════════════
-- PARTE 2: AUDITORÍA DE TRIGGERS Y RPCs QUE TOCAN students.balance
-- ════════════════════════════════════════════════════════════════

-- 2-A) Todos los triggers activos sobre la tabla 'transactions'
--      (el trigger update_student_balance vive aquí)
SELECT
  tgname         AS trigger_nombre,
  CASE tgtype & 2  WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS momento,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 8  THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 28 THEN 'INSERT/UPDATE/DELETE'
    ELSE         tgtype::text
  END            AS evento,
  proname        AS funcion,
  tgenabled      AS activo
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.transactions'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;

-- 2-B) Triggers sobre la tabla 'students'
SELECT
  tgname         AS trigger_nombre,
  CASE tgtype & 2  WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS momento,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 8  THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 28 THEN 'INSERT/UPDATE/DELETE'
    ELSE         tgtype::text
  END            AS evento,
  proname        AS funcion,
  tgenabled      AS activo
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.students'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;

-- 2-C) TODAS las funciones/RPCs que tienen 'balance' + 'students' en su cuerpo
--      (incluye el trigger update_student_balance, adjust_student_balance,
--       set_student_balance, y cualquier otra función oculta)
SELECT
  proname                AS funcion,
  CASE prokind
    WHEN 'f' THEN 'función'
    WHEN 'p' THEN 'procedure'
    WHEN 't' THEN 'trigger fn'
    WHEN 'a' THEN 'aggregate'
  END                    AS tipo,
  CASE prosecdef
    WHEN true THEN '⚠️ SECURITY DEFINER'
    ELSE 'normal'
  END                    AS seguridad,
  LEFT(prosrc, 300)      AS primeras_300_chars
FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND prosrc ILIKE '%students%'
  AND prosrc ILIKE '%balance%'
ORDER BY proname;

-- 2-D) Verificar quién TIENE EXECUTE sobre set_student_balance ahora mismo
--      (debe estar vacío si el REVOKE del escudo antifraude se aplicó)
SELECT
  grantee,
  routine_name,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN ('set_student_balance', 'adjust_student_balance')
ORDER BY routine_name, grantee;


-- ════════════════════════════════════════════════════════════════
-- PARTE 3: AUDIT LOGS
-- Busca en la tabla audit_logs si se registró el set_balance de Ema
-- (esta tabla fue creada en CREATE_AUDIT_LOGS_TABLE.sql)
-- ════════════════════════════════════════════════════════════════

-- 3-A) Ver estructura de audit_logs
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'audit_logs'
ORDER BY ordinal_position;

-- 3-B) Buscar entradas relacionadas con Ema o con set_student_balance
SELECT *
FROM audit_logs
WHERE
  (record_id::text = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
   OR old_data::text ILIKE '%f9f2569a%'
   OR new_data::text ILIKE '%f9f2569a%'
   OR action ILIKE '%balance%'
   OR action ILIKE '%set_student%')
ORDER BY created_at ASC
LIMIT 50;

-- 3-C) Últimas 50 entradas en audit_logs sobre la tabla students
SELECT *
FROM audit_logs
WHERE table_name = 'students'
ORDER BY created_at DESC
LIMIT 50;
